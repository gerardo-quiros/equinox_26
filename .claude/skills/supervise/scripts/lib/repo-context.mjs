// Recoge el contexto de una revisión: rama base, merge-base, diff, commits, especificaciones y convenciones.
// Solo lee el repositorio con git (argumentos en array, sin shell). No ejecuta código del proyecto.
// El contenido del repositorio es DATO no confiable: este módulo no interpreta instrucciones de los archivos.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LIMITS = {
  conventionsBytes: 8_000,
  readmeBytes: 4_000,
  largePatchLines: 3_000,
};

// Archivos generados o de dependencias: no aportan criterio humano y ocupan espacio.
const EXCLUDED_NAMES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'go.sum', 'Cargo.lock', 'Gemfile.lock', 'composer.lock']);
export const isExcluded = (path) => {
  const name = basename(path);
  return EXCLUDED_NAMES.has(name) || /\.(lock|min\.js|map)$/.test(name);
};

/* ============ git ============ */

function git(root, args, { allowStatus = [] } = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (allowStatus.includes(e.status)) return e.stdout?.toString() ?? '';
    throw new Error(`git ${args[0]}: ${String(e.stderr || e.message).trim()}`);
  }
}

const tryGit = (root, args) => {
  try { return git(root, args).trim() || null; } catch { return null; }
};

function detectRoot(cwd) {
  let root;
  try {
    root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error('No estás dentro de un repositorio git. /supervise necesita git para calcular la rama y el diff.');
  }
  return root;
}

// Acepta «rama» o «origin/rama». Prefiere la local.
const resolveRef = (root, name) =>
  [name, `origin/${name}`].find((ref) => tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) ?? null;

function resolveBase(root, explicit) {
  if (explicit) {
    const ref = resolveRef(root, explicit);
    if (!ref) throw new Error(`No existe la rama base «${explicit}».`);
    return { name: explicit, ref, source: '--base' };
  }
  const remoteHead = tryGit(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']); // refs/remotes/origin/main
  if (remoteHead) {
    const ref = remoteHead.replace('refs/remotes/', '');
    if (tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) {
      return { name: ref.replace(/^origin\//, ''), ref, source: 'origin/HEAD' };
    }
  }
  for (const name of ['main', 'master']) {
    const ref = resolveRef(root, name);
    if (ref) return { name, ref, source: 'por convención main/master' };
  }
  throw new Error('No encuentro la rama base. Indícala con --base <rama>.');
}

/* ============ diff ============ */

// Divide un parche en secciones por archivo y calcula estadísticas a partir del propio texto.
export function splitPatch(patch) {
  const sections = [];
  let current = null;
  for (const line of patch.split('\n')) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header) {
      current = { path: header[2], status: 'modified', additions: 0, deletions: 0, lines: [line] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('rename from')) current.status = 'renamed';
    else if (line.startsWith('+') && !line.startsWith('+++')) current.additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) current.deletions++;
  }
  return sections.map((s) => ({ ...s, text: s.lines.join('\n') }));
}

const untrackedFiles = (root) =>
  git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);

function untrackedPatch(root, files) {
  // «git diff --no-index» devuelve 1 cuando hay diferencias: es el resultado esperado.
  return files.map((file) => git(root, ['diff', '--no-index', '--', '/dev/null', file], { allowStatus: [1] })).join('');
}

/* ============ especificaciones y convenciones ============ */

const readCapped = (path, maxBytes) => {
  const buffer = readFileSync(path);
  const truncated = buffer.length > maxBytes;
  return { content: buffer.subarray(0, maxBytes).toString('utf8'), truncated };
};

// SpecKit: specs/<NNN-nombre>/{spec,plan,tasks}.md. No se decide aquí cuál corresponde a la rama:
// se listan todas y el agente lee las que encajen con el cambio.
function findSpecs(root) {
  const dir = join(root, 'specs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .map((name) => ({
      dir: `specs/${name}`,
      files: ['spec.md', 'plan.md', 'tasks.md'].filter((file) => existsSync(join(dir, name, file))),
    }))
    .filter((spec) => spec.files.length);
}

function conventionsOf(root, hasSpecs) {
  const out = [];
  const claude = join(root, 'CLAUDE.md');
  if (existsSync(claude)) out.push({ path: 'CLAUDE.md', ...readCapped(claude, LIMITS.conventionsBytes) });
  const readme = join(root, 'README.md');
  if (!hasSpecs && existsSync(readme)) out.push({ path: 'README.md', ...readCapped(readme, LIMITS.readmeBytes) });
  return out;
}

function projectName(root) {
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    try { const name = JSON.parse(readFileSync(pkg, 'utf8')).name; if (name) return String(name); } catch { /* se usa el nombre de la carpeta */ }
  }
  return basename(root);
}

/* ============ remoto (para enlazar el código en GitHub) ============ */

/** Convierte la URL del remoto en la URL web de GitHub, o null si no es GitHub. Quita credenciales. */
export function githubWebUrl(remote) {
  if (!remote) return null;
  const match = remote.trim().match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

// El commit está publicado si alguna rama remota lo contiene: solo entonces los enlaces funcionan.
const isPublished = (root, sha) => Boolean(tryGit(root, ['branch', '-r', '--contains', sha]));

/* ============ punto de entrada ============ */

export const slug = (text) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'revision';

export const stampOf = (date) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
};

/**
 * Revisa la rama actual frente a su base: commits propios, cambios sin commitear y archivos nuevos sin seguimiento.
 * @param {{cwd?: string, base?: string|null, now?: Date}} options
 */
export function collectContext({ cwd = process.cwd(), base: explicitBase = null, now = new Date() } = {}) {
  const root = detectRoot(cwd);
  const warnings = [];

  let head;
  try {
    head = git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    throw new Error('El repositorio no tiene commits todavía. Haz al menos un commit antes de usar /supervise.');
  }

  const currentBranch = tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain']).split('\n').some(Boolean);
  const base = resolveBase(root, explicitBase);
  const headName = currentBranch ?? `HEAD (detached ${head.slice(0, 7)})`;

  let mergeBase;
  try {
    mergeBase = git(root, ['merge-base', base.ref, head]).trim();
  } catch {
    throw new Error(`«${headName}» no comparte historia con la base «${base.name}».`);
  }

  if (mergeBase === head && !dirty) {
    throw new Error(`No hay cambios que revisar frente a «${base.name}». Cambia de rama.`);
  }
  if (currentBranch === base.name) {
    warnings.push(`Estás en la rama base «${base.name}»: solo se revisan los cambios sin commitear.`);
  }

  // Diff contra el merge-base: commits y cambios sin commitear de los archivos con seguimiento, más los archivos nuevos.
  const trackedPatch = git(root, ['diff', '--no-color', '--find-renames', mergeBase]);
  const untracked = untrackedFiles(root);

  const sections = splitPatch(trackedPatch + untrackedPatch(root, untracked));
  const excluded = sections.filter((s) => isExcluded(s.path)).map((s) => s.path);
  const kept = sections.filter((s) => !isExcluded(s.path));
  const patch = kept.map((s) => s.text).join('\n') + (kept.length ? '\n' : '');

  const files = kept
    .map(({ path, status, additions, deletions }) => ({ path, status, additions, deletions }))
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  if (!files.length) {
    throw new Error(`No hay cambios revisables frente a «${base.name}» (solo se han excluido archivos generados: ${excluded.join(', ') || '—'}).`);
  }

  const stats = files.reduce((acc, f) => ({
    filesChanged: acc.filesChanged + 1, additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions,
  }), { filesChanged: 0, additions: 0, deletions: 0 });

  const patchLines = patch.split('\n').length;
  const largeDiff = patchLines > LIMITS.largePatchLines;
  if (largeDiff) warnings.push(`Diff grande (${patchLines} líneas): léelo por archivos, empezando por los de más cambios, y apóyate en las especificaciones.`);

  const commits = git(root, ['log', '--format=%h%x09%s', `${mergeBase}..${head}`])
    .split('\n').filter(Boolean).map((line) => {
      const [sha, ...subject] = line.split('\t');
      return { sha, subject: subject.join('\t') };
    });

  const specs = findSpecs(root);
  if (!specs.length) warnings.push('No hay especificaciones: la revisión se basa en el diff y en las convenciones del proyecto.');

  const reviewId = `${slug(headName)}-${head.slice(0, 7)}${dirty ? '-dirty' : ''}-${stampOf(now)}`;
  const repoUrl = githubWebUrl(tryGit(root, ['remote', 'get-url', 'origin']));
  const published = repoUrl ? isPublished(root, head) : false;

  return {
    reviewId,
    generatedAt: now.toISOString(),
    root,
    project: projectName(root),
    head: { name: headName, sha: head },
    base,
    mergeBase,
    dirty,
    repoUrl,
    published,
    lastCommitSubject: tryGit(root, ['log', '-1', '--format=%s']),
    commits,
    stats,
    files,
    excluded,
    largeDiff,
    patch,
    specs,
    conventions: conventionsOf(root, specs.length > 0),
    warnings,
  };
}

/** Parte de context.json que lee el agente (sin el parche, que va en changes.patch). */
export function contextSummary(ctx) {
  const { patch: _omitted, ...rest } = ctx;
  return {
    ...rest,
    // Metadatos ya listos para review.json: el agente solo añade el resto.
    metaDraft: {
      reviewId: ctx.reviewId,
      project: ctx.project,
      title: (ctx.lastCommitSubject ?? ctx.head.name).slice(0, 120),
      summary: '(pendiente: 1–2 frases sobre qué hace el cambio)',
      generatedAt: ctx.generatedAt,
      source: {
        type: 'branch',
        base: ctx.base.name,
        head: ctx.head.name,
        mergeBase: ctx.mergeBase,
        commit: ctx.head.sha,
        dirty: ctx.dirty,
        ...(ctx.repoUrl ? { repoUrl: ctx.repoUrl, published: ctx.published } : {}),
      },
      stats: ctx.stats,
    },
  };
}
