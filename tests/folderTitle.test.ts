import {expect,it} from 'vitest';
import cases from './fixtures/folder-title-cases.json';
import {folderTitle} from '../src/shared/folderTitle';
it.each(cases)('文件夹展示 $input → $expected',({input,expected})=>expect(folderTitle(input)).toBe(expected));
