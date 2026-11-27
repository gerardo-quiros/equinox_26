// Recoge el contexto de una revisión: rama base, merge-base, diff, commits, especificaciones y convenciones.
// Solo lee el repositorio con git (argumentos en array, sin shell). No ejecuta código del proyecto.
// El contenido del repositorio es DATO no confiable: este módulo no interpreta instrucciones de los archivos.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LIMITS = {
  specBytes: 20_000,
  conventionsBytes: 8_000,
  readmeBytes: 4_000,
  commits: 30,
  untrackedBytes: 1_000_000,
  largePatchLines: 3_000,
  largePatchBytes: 300_000,
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

const titleOf = (text) => (text.match(/^#\s+(.+)$/m)?.[1] ?? '').trim() || null;

// SpecKit: specs/<NNN-nombre>/{spec,plan,tasks}.md. Se asocia a la rama por nombre o por cambio en el diff.
function findSpecs(root, branch, changedPaths) {
  const dir = join(root, 'specs');
  if (!existsSync(dir)) return { specs: [], unmatched: [] };
  const names = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
  const lowerBranch = branch.toLowerCase();
  const matches = (name) => {
    const bare = name.replace(/^\d+-/, '').toLowerCase();
    return lowerBranch.includes(name.toLowerCase()) || (bare.length >= 3 && lowerBranch.includes(bare))
      || changedPaths.some((p) => p.startsWith(`specs/${name}/`));
  };
  const picked = names.filter(matches);
  const specs = picked.flatMap((name) =>
    ['spec.md', 'plan.md', 'tasks.md'].flatMap((file) => {
      const path = join(dir, name, file);
      if (!existsSync(path)) return [];
      const { content, truncated } = readCapped(path, LIMITS.specBytes);
      return [{ path: `specs/${name}/${file}`, title: titleOf(content), content, truncated }];
    }));
  return { specs, unmatched: names.filter((n) => !picked.includes(n)) };
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

/* ============ punto de entrada ============ */

export const slug = (text) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'revision';

export const stampOf = (date) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
};

/**
 * @param {{cwd?: string, branch?: string|null, base?: string|null, now?: Date}} options
 *   branch: si se indica, se revisan solo los commits de esa rama (sin cambios sin commitear).
 */
export function collectContext({ cwd = process.cwd(), branch = null, base: explicitBase = null, now = new Date() } = {}) {
  const root = detectRoot(cwd);
  const warnings = [];

  let headSha;
  try {
    headSha = git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    throw new Error('El repositorio no tiene commits todavía. Haz al menos un commit antes de usar /supervise.');
  }

  const currentBranch = tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const statusLines = git(root, ['status', '--porcelain']).split('\n').filter(Boolean);
  const base = resolveBase(root, explicitBase);

  let mode;
  let head;
  let headName;
  if (branch) {
    const ref = resolveRef(root, branch);
    if (!ref) throw new Error(`No existe la rama «${branch}».`);
    mode = 'branch';
    head = git(root, ['rev-parse', ref]).trim();
    headName = branch;
    if (statusLines.length && currentBranch === branch) {
      warnings.push(`Hay ${statusLines.length} cambio(s) sin commitear que NO se incluyen: esta revisión cubre solo los commits de «${branch}».`);
    }
  } else {
    mode = 'working';
    head = headSha;
    headName = currentBranch ?? `HEAD (detached ${headSha.slice(0, 7)})`;
  }

  let mergeBase;
  try {
    mergeBase = git(root, ['merge-base', base.ref, head]).trim();
  } catch {
    throw new Error(`«${headName}» no comparte historia con la base «${base.name}».`);
  }

  if (mode === 'working' && mergeBase === headSha && !statusLines.length) {
    throw new Error(`No hay cambios que revisar frente a «${base.name}». Cambia de rama o usa /supervise <rama>.`);
  }
  if (mode === 'branch' && mergeBase === head) {
    throw new Error(`«${branch}» no tiene commits propios frente a «${base.name}».`);
  }
  if (mode === 'working' && currentBranch === base.name) {
    warnings.push(`Estás en la rama base «${base.name}»: solo se revisan los cambios sin commitear.`);
  }

  // Diff: cambios de los archivos con seguimiento (commits y, en modo working, sin commitear) + archivos nuevos sin seguimiento.
  const rangeArgs = mode === 'working' ? [mergeBase] : [mergeBase, head];
  const trackedPatch = git(root, ['diff', '--no-color', '--find-renames', ...rangeArgs]);
  const untracked = mode === 'working' ? untrackedFiles(root) : [];
  const skippedUntracked = [];
  const readableUntracked = untracked.filter((file) => {
    if (statSync(join(root, file)).size > LIMITS.untrackedBytes) { skippedUntracked.push(file); return false; }
    return true;
  });
  if (skippedUntracked.length) warnings.push(`Archivos nuevos demasiado grandes, no incluidos: ${skippedUntracked.join(', ')}`);

  const sections = splitPatch(trackedPatch + untrackedPatch(root, readableUntracked));
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
  const largeDiff = patchLines > LIMITS.largePatchLines || Buffer.byteLength(patch) > LIMITS.largePatchBytes;
  if (largeDiff) warnings.push(`Diff grande (${patchLines} líneas): léelo por archivos, empezando por los de más cambios, y apóyate en las especificaciones.`);

  const dirtyList = mode === 'working' ? statusLines : [];
  const commits = git(root, ['log', `--max-count=${LIMITS.commits}`, '--format=%h%x09%s', `${mergeBase}..${head}`])
    .split('\n').filter(Boolean).map((line) => {
      const [sha, ...subject] = line.split('\t');
      return { sha, subject: subject.join('\t') };
    });

  const { specs, unmatched } = findSpecs(root, headName, files.map((f) => f.path));
  if (!specs.length) {
    warnings.push(unmatched.length
      ? `Hay especificaciones que no se asocian a la rama (${unmatched.join(', ')}). Si corresponden, renombra la rama o indícalo al revisar.`
      : 'No hay especificaciones: la revisión se basa en el diff y en las convenciones del proyecto.');
  } else if (unmatched.length) {
    warnings.push(`Otras especificaciones del proyecto no se asocian a esta rama: ${unmatched.join(', ')}.`);
  }

  const shortSha = headSha.slice(0, 7);
  const reviewId = `${slug(headName)}-${shortSha}${dirtyList.length ? '-dirty' : ''}-${stampOf(now)}`;

  return {
    reviewId,
    generatedAt: now.toISOString(),
    root,
    project: projectName(root),
    mode,
    head: { name: headName, sha: head },
    base,
    mergeBase,
    dirty: { count: dirtyList.length, entries: dirtyList.slice(0, 50) },
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
        dirty: ctx.dirty.count > 0,
      },
      stats: ctx.stats,
    },
  };
}
