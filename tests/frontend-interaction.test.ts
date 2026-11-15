// @vitest-environment jsdom
import { describe,it,expect,afterEach } from 'vitest';
import { createElement,act,type ReactNode } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { Modal,Field } from '../src/renderer/components/primitives';
import { BrowseMemory } from '../src/renderer/lib/browseMemory';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;document.body.replaceChildren();});
function hModal(props:Omit<Parameters<typeof Modal>[0],'children'>,...children:ReactNode[]){return createElement(Modal,{...props,children});}
function hField(props:Omit<Parameters<typeof Field>[0],'children'>,...children:ReactNode[]){return createElement(Field,{...props,children});}
function render(element:ReturnType<typeof createElement>){if(!root){const node=document.createElement('div');document.body.append(node);root=createRoot(node);}act(()=>root!.render(element));}
describe('stable modal lifecycle',()=>{
 it('keeps the edited field when the parent supplies a new close callback',()=>{
  const form=()=>hModal({open:true,title:'编辑',onClose:()=>{}},createElement('input',{id:'name',autoFocus:true}),createElement('textarea',{id:'notes'}));
  render(form());const notes=document.querySelector<HTMLTextAreaElement>('#notes')!;notes.focus();notes.value='甲乙';render(form());expect(document.activeElement).toBe(notes);expect(notes.value).toBe('甲乙');
 });
 it('restores the trigger even when a portal input has autoFocus',()=>{
  const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
  const form=(open:boolean)=>hModal({open,title:'输入',onClose:()=>{}},createElement('input',{autoFocus:true}));
  render(form(false));trigger.focus();render(form(true));expect(document.activeElement?.tagName).toBe('INPUT');render(form(false));expect(document.activeElement).toBe(trigger);
 });
 it('uses the latest close callback and traps Tab around disabled controls',()=>{
  let current='';const form=(value:string)=>hModal({open:true,title:'输入',onClose:()=>{current=value;}},createElement('input',{id:'edit'}),createElement('button',{disabled:true},'保存'),createElement('button',{id:'last'},'取消'));
  render(form('old'));render(form('latest'));document.querySelector<HTMLButtonElement>('#last')!.focus();act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭');act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(current).toBe('latest');
 });
 it('associates errors and hints with the real input without erasing a description',()=>{
  render(hField({label:'专题名称',htmlFor:'title',error:'名称不能为空'},createElement('input',{id:'title','aria-describedby':'existing'})));
  const input=document.querySelector<HTMLInputElement>('#title')!;expect(input.getAttribute('aria-invalid')).toBe('true');expect(input.getAttribute('aria-describedby')).toBe('existing title-error');expect(document.querySelector('#title-error')?.getAttribute('role')).toBe('alert');
  render(hField({label:'专题名称',htmlFor:'title',hint:'本机唯一'},createElement('input',{id:'title'})));expect(input.hasAttribute('aria-invalid')).toBe(false);expect(input.getAttribute('aria-describedby')).toBe('title-hint');
 });
});
describe('bounded history memory',()=>{
 it('keeps filters, focus and scroll together per history entry',()=>{const memory=new BrowseMemory(3);memory.value('a','search','绝命毒师');memory.remember('a',{scrollTop:400,focusKey:'film:1'});memory.value('b','search','沙丘');expect(memory.read('a')).toEqual({scrollTop:400,focusKey:'film:1',values:{search:'绝命毒师'}});expect(memory.read('b')?.values.search).toBe('沙丘');});
 it('evicts old history entries while preserving the most recently used one',()=>{const memory=new BrowseMemory(2);memory.remember('a',{scrollTop:10});memory.remember('b',{scrollTop:20});memory.value('a','sort','title');memory.remember('c',{scrollTop:30});expect(memory.read('b')).toBeUndefined();expect(memory.read('a')?.scrollTop).toBe(10);expect(memory.read('c')?.scrollTop).toBe(30);});
});
