// Порт tweb `src/scripts/generate_mtproto_types.js` 1:1.
//
// Читает схему (`schema/schema.json` в корне репозитория) плюс два файла
// надстроек и печатает
// `src/layer.d.ts` — типы всех конструкторов и методов. Запуск:
// `npm run generate-mtproto-types`.
//
// Единственное расхождение с оригиналом: модульная система. У нас
// `"type": "module"`, поэтому `require` заменён на `import`, а `__dirname` —
// на вычисление из `import.meta.url`. Логика генерации не тронута.
//
// Про две надстройки над схемой:
//   `schema_additional_params.json` — клиентские поля, которых нет на проводе.
//     Параметрам ставится префикс `flags.-1?` (сентинел «клиентское»), после
//     чего они попадают в тип наравне с настоящими. Так у оригинала в `message`
//     живут `mid`/`peerId`/`storageKey`, а в `pFlags` — `is_outgoing`/`local`.
//     Сюда же добавляются НАШИ собственные поля — отдельного места не заводим.
//   `schema_replace_types.json` — точечная замена типа по имени параметра.
import {readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Схема — общий источник для обеих сторон: из неё генерируются типы фронта и
// (фаза 2) кодек со структурами на Go. Поэтому она лежит не внутри web-client,
// а в `schema/` в корне репозитория.
const SCHEMA_DIR = join(__dirname, '../../schema');
const readJSON = (name) => JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8'));

const schema = readJSON('schema.json');
const additional = readJSON('schema_additional_params.json');
const replace = readJSON('schema_replace_types.json');

const mtproto = schema.API;

const TABULATION = '  ';
const NEW_LINE = '\n';
const FLAGS_KEYS = new Set(['flags', 'flags2']);

for(const constructor of additional) {
  const additionalParams = constructor.params || (constructor.params = []);
  additionalParams.forEach(param => {
    param.type = 'flags.-1?' + param.type;
  });

  if(constructor.properties) {
    additionalParams.push(...constructor.properties);
  }

  if(constructor.type) {
    mtproto.constructors.push(constructor);
  }

  const realConstructor = constructor.type ? constructor : mtproto.constructors.find(c => c.predicate == constructor.predicate);

  if(!constructor.type) {
    if(!realConstructor) {
      console.log(realConstructor, constructor);
    }

    for(let i = realConstructor.params.length - 1; i >= 0; --i) {
      const param = realConstructor.params[i];
      if(additionalParams.find(newParam => newParam.name === param.name)) {
        realConstructor.params.splice(i, 1);
      }
    }
  }

  realConstructor.params.splice(realConstructor.params.length, 0, ...additionalParams);
}

['Vector t', 'Bool', 'True', 'Null'].forEach(key => {
  let idx = -1;
  do {
    idx = mtproto.constructors.findIndex(c => c.type == key);
    if(idx !== -1) {
      mtproto.constructors.splice(idx, 1);
    } else {
      break;
    }
  } while(true);
});

/** @type {(string: string) => string} */
function capitalizeFirstLetter(string) {
  return string[0].toUpperCase() + string.slice(1);
}

/** @type {(string: string, camelizeFirstLetterIfFound: boolean, camelizeFirstLetterIfNotFound: boolean) => string} */
function camelizeName(string, camelizeFirstLetterIfFound, camelizeFirstLetterIfNotFound = false) {
  if(!string.includes('.')) {
    if(camelizeFirstLetterIfNotFound) {
      string = capitalizeFirstLetter(string);
    }

    return string;
  }

  if(camelizeFirstLetterIfFound) {
    string = capitalizeFirstLetter(string);
  }

  return string.replace(/\../g, (match) => {
    return match[1].toUpperCase();
  });
}

/** @type {(type: string, parseBooleanFlags: boolean, overrideTypes?: {[type: string]: string}) => any} */
const processParamType = (type, parseBooleanFlags, overrideTypes) => {
  const isAdditional = type.indexOf('flags.-1?') === 0;
  const isFlag = type.includes('?');
  if(isFlag) {
    type = type.split('?')[1];
  }

  if(type.includes('Vector')) {
    return `Array<${processParamType(type.slice(7, -1), parseBooleanFlags, overrideTypes)}>`;
  }

  const overridden = overrideTypes && overrideTypes[type];
  if(overridden) {
    return overridden;
  }

  switch(type) {
    case '#':
    case 'int':
      return 'number';

    case 'true':
      return parseBooleanFlags ? 'true' : 'boolean';

    case 'Bool':
      return 'boolean';

    case 'double':
      return 'number';

    case 'long':
      return 'string | number';

    case 'bytes':
      return 'Uint8Array';

    case 'string':
      return 'string';

    case 'X':
    case '!X':
      return 'any';

    default:
      return isAdditional || type[0] === type[0].toUpperCase() ? type : camelizeName(type, true);
  }
};

/** @type {(params: {name: string, type: string}[], object: any, parseBooleanFlags: boolean, overrideTypes?: {[type: string]: string}) => any} */
const processParams = (params, object = {}, parseBooleanFlags = true, overrideTypes) => {
  for(const param of params) {
    let {name, type} = param;

    if((type.includes('?') || FLAGS_KEYS.has(name)) && !name.includes('`')) {
      name += '?';
    }

    if(replace[name]) {
      type = replace[name];
    }

    const processed = processParamType(type, parseBooleanFlags, overrideTypes);
    if(type.includes('?true') && parseBooleanFlags) {
      if(!object.pFlags) object.pFlags = {};
      object.pFlags[name] = processed;
    } else {
      object[name] = processed;
    }
  }

  return object;
};

/** @type {(object: any) => boolean} */
function isObject(object) {
  return typeof(object) === 'object' && object !== null;
}

/** @type {(object: any, outArray: string[], space: string) => string[]} */
function serializeObject(object, outArray, space) {
  for(const key in object) {
    const value = object[key];

    if(isObject(value)) { // only pFlags
      outArray.push(`${space}${key}: Partial<{`);
      serializeObject(value, outArray, space + TABULATION);
      outArray.push(`${space}}>`);
    } else {
      outArray.push(`${space}${key}: ${value}`);
    }
  }

  return outArray;
}

let out = '';

/** @type {{[type: string]: string[]}} */
const types = {};
/** @type {{[predicate: string]: any}} */
const constructors = {};
/** @type {{[predicate: string]: string}} */
const constructorsTypes = {};

mtproto.constructors.forEach((constructor) => {
  const {type, predicate, params} = constructor;

  if(!Object.prototype.hasOwnProperty.call(types, type)) {
    types[type] = [];
  }

  types[type].push(predicate);

  constructorsTypes[predicate] = camelizeName(type, true) + '.' + camelizeName(predicate, false);

  /** @type {any} */
  const c = {
    _: `'${predicate}'`
  };
  constructors[predicate] = c;

  processParams(params, c, true);
});

for(const type in types) {
  const cs = types[type];

  const camelizedType = camelizeName(type, true);

  const csTypes = cs.map(name => {
    const str = `export type ${camelizeName(name, false)} = {${NEW_LINE}`;

    const params = serializeObject(constructors[name], [], TABULATION + TABULATION);

    return str + params.join(`,${NEW_LINE}`).replace(/\{,/g, '{') + `${NEW_LINE}${TABULATION}};`;
  });

  out += `/**
 * @link https://core.telegram.org/type/${type}
 */
export type ${camelizedType} = ${cs.map(name => camelizedType + '.' + camelizeName(name, false)).join(' | ')};

export namespace ${camelizedType} {
  ${csTypes.join(`${NEW_LINE}${NEW_LINE}${TABULATION}`)}
}

`;
}

out += `export interface ConstructorDeclMap {${NEW_LINE}`;
for(const predicate in constructorsTypes) {
  out += `${TABULATION}'${predicate}': ${constructorsTypes[predicate]},${NEW_LINE}`;
}
out += `}${NEW_LINE}${NEW_LINE}`;

/** @type {{[method: string]: {req: string, res: string}}} */
const methodsMap = {};
mtproto.methods.forEach((_method) => {
  const {method, type, params} = _method;

  const camelizedMethod = camelizeName(method, true, true);

  methodsMap[method] = {
    req: camelizedMethod,
    res: processParamType(type, false, {'JSONValue': 'any'})
  };

  let str = `export type ${camelizedMethod} = {${NEW_LINE}`;

  const object = processParams(params, {}, false);

  const serialized = serializeObject(object, [], TABULATION);

  str += serialized.join(`,${NEW_LINE}`).replace(/\{,/g, '{') + `${NEW_LINE}};${NEW_LINE}${NEW_LINE}`;
  out += str;
});

out += `export interface MethodDeclMap {${NEW_LINE}`;
for(const method in methodsMap) {
  out += `${TABULATION}'${method}': {req: ${methodsMap[method].req}, res: ${methodsMap[method].res}},${NEW_LINE}`;
}
out += `}${NEW_LINE}${NEW_LINE}`;

const path = process.argv[2];
const writePathTo = (path || join(__dirname, 'out/')) + 'layer.d.ts';
console.log('Writing layer to:', writePathTo);
writeFileSync(writePathTo, out);
