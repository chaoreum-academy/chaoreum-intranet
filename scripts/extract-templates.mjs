// 원본 코드에서 문장 템플릿을 그대로 뽑아 lib/omr/templates.json 으로 저장 (사람이 옮겨 적지 않음)
import fs from 'node:fs';
import { loadLegacy } from './legacy-sandbox.mjs';
const { __T } = loadLegacy();
const { TEACHER, ...templates } = __T;
fs.writeFileSync(new URL('../lib/omr/templates.json', import.meta.url), JSON.stringify(templates, null, 2) + '\n');
console.log('templates.json 생성:', Object.keys(templates).join(', '));
