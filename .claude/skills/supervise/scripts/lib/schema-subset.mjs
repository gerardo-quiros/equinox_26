// Validador de un subconjunto de JSON Schema (draft 2020-12), sin dependencias.
// Funciona en Node y en el navegador. Si el schema usa una palabra clave que no
// está soportada, lanza una excepción en lugar de ignorarla en silencio: así el
// schema y el validador no pueden divergir.

const ANNOTATIONS = new Set([
  '$schema', '$id', '$defs', '$comment', 'title', 'description', 'examples', 'default',
]);

const SUPPORTED = new Set([
  '$ref', 'type', 'const', 'enum',
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'properties', 'required', 'additionalProperties',
]);

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const typeOf = (v) =>
  v === null ? 'null'
    : Array.isArray(v) ? 'array'
      : Number.isInteger(v) ? 'integer'
        : typeof v;

const matchesType = (value, type) => {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};

const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
};

// Longitud en puntos de código, como define JSON Schema (no en unidades UTF-16).
const codePointLength = (s) => [...s].length;

export const formatPath = (path) => path || '(raíz)';

/**
 * Valida `data` contra `schema`.
 * @returns {{path: string, message: string}[]} lista de errores (vacía si es válido)
 */
export function validateAgainstSchema(data, schema) {
  const errors = [];
  const regexCache = new Map();

  const fail = (path, message) => errors.push({ path: formatPath(path), message });

  const regex = (pattern) => {
    if (!regexCache.has(pattern)) regexCache.set(pattern, new RegExp(pattern, 'u'));
    return regexCache.get(pattern);
  };

  const resolve = (ref) => {
    if (!ref.startsWith('#/')) throw new Error(`$ref no soportado: ${ref}`);
    return ref.slice(2).split('/').reduce((node, key) => {
      if (!node || !(key in node)) throw new Error(`$ref no encontrado: ${ref}`);
      return node[key];
    }, schema);
  };

  const join = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

  function walk(value, node, path) {
    for (const key of Object.keys(node)) {
      if (!ANNOTATIONS.has(key) && !SUPPORTED.has(key)) {
        throw new Error(`Palabra clave de JSON Schema no soportada: "${key}"`);
      }
    }

    if (node.$ref) walk(value, resolve(node.$ref), path);

    if ('const' in node && !deepEqual(value, node.const)) {
      fail(path, `debe ser ${JSON.stringify(node.const)}`);
    }
    if (node.enum && !node.enum.some((e) => deepEqual(e, value))) {
      fail(path, `valor ${JSON.stringify(value)} no permitido; usa uno de: ${node.enum.join(', ')}`);
    }
    if (node.type) {
      const types = [].concat(node.type);
      if (!types.some((t) => matchesType(value, t))) {
        fail(path, `se esperaba ${types.join(' o ')} y se recibió ${typeOf(value)}`);
        return; // el resto de reglas no tiene sentido con el tipo equivocado
      }
    }

    if (typeof value === 'string') {
      const len = codePointLength(value);
      if (node.minLength !== undefined && len < node.minLength) fail(path, `mínimo ${node.minLength} caracteres`);
      if (node.maxLength !== undefined && len > node.maxLength) fail(path, `máximo ${node.maxLength} caracteres (tiene ${len})`);
      if (node.pattern !== undefined && !regex(node.pattern).test(value)) {
        fail(path, node.pattern === '\\S' ? 'no puede estar vacío' : `no cumple el formato ${node.pattern}`);
      }
      if (node.format === 'date-time' && (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))) {
        fail(path, 'debe ser una fecha ISO 8601 con zona horaria, p. ej. 2026-11-26T10:00:00Z');
      }
    }

    if (typeof value === 'number') {
      if (node.minimum !== undefined && value < node.minimum) fail(path, `debe ser ≥ ${node.minimum}`);
      if (node.maximum !== undefined && value > node.maximum) fail(path, `debe ser ≤ ${node.maximum}`);
    }

    if (Array.isArray(value)) {
      if (node.minItems !== undefined && value.length < node.minItems) fail(path, `mínimo ${node.minItems} elementos (tiene ${value.length})`);
      if (node.maxItems !== undefined && value.length > node.maxItems) fail(path, `máximo ${node.maxItems} elementos (tiene ${value.length})`);
      if (node.uniqueItems) {
        value.forEach((item, i) => {
          if (value.findIndex((other) => deepEqual(other, item)) !== i) fail(join(path, i), 'elemento duplicado');
        });
      }
      if (node.items) value.forEach((item, i) => walk(item, node.items, join(path, i)));
    }

    if (typeOf(value) === 'object') {
      for (const key of node.required ?? []) {
        if (!(key in value)) fail(join(path, key), 'campo obligatorio ausente');
      }
      const props = node.properties ?? {};
      for (const [key, child] of Object.entries(value)) {
        if (key in props) walk(child, props[key], join(path, key));
        else if (node.additionalProperties === false) fail(join(path, key), 'campo no permitido');
        else if (typeof node.additionalProperties === 'object') walk(child, node.additionalProperties, join(path, key));
      }
    }
  }

  walk(data, schema, '');
  return errors;
}
