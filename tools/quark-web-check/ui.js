const statusNode = document.querySelector('#status');
const errorNode = document.querySelector('#error');
const filesNode = document.querySelector('#files');
const countNode = document.querySelector('#count');
const trailNode = document.querySelector('#trail');
let trail = [{ id: '0', name: '夸克网盘' }];
const labels = { not_checked: '尚未检查', login_required: '尚未获得目录访问会话，请在官方网页登录', unavailable: '暂时无法验证连接', directory_access_verified: '目录接口已验证可访问；不等于影视已导入' };
function renderState(data) {
  if (data) { statusNode.textContent = labels[data.state] || '状态未知'; errorNode.textContent = data.error || ''; }
}
async function run(action, id) {
  if (action === 'login') { filesNode.replaceChildren(); countNode.textContent = ''; trail = [{ id: '0', name: '夸克网盘' }]; renderTrail(); }
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
  errorNode.textContent = ''; statusNode.textContent = '正在处理…';
  try {
    const result = await window.quarkCheck.action(action, id); renderState(result.data);
    if (!result.ok) { errorNode.textContent = result.error; return false; }
    if (action === 'list') {
      filesNode.replaceChildren(); countNode.textContent = `本目录完整读取 ${result.data.total} 项，其中视频 ${result.data.items.filter(item => item.video).length} 项。最多显示前200项。`;
      for (const item of result.data.items.slice(0, 200)) {
        const row = document.createElement('li');
        if (item.directory) {
          const button = document.createElement('button'); button.textContent = `文件夹 · ${item.name}`;
          button.onclick = async () => { if (await run('list', item.id)) { trail.push({ id: item.id, name: item.name }); renderTrail(); } }; row.append(button);
        } else row.textContent = `${item.video ? '视频' : '文件'} · ${item.name}`;
        filesNode.append(row);
      }
    }
    return true;
  } catch { statusNode.textContent = '检查失败'; errorNode.textContent = '验证工具接口暂不可用，请重新打开工具。'; return false; }
  finally { document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}
function renderTrail() {
  trailNode.replaceChildren(); trail.forEach((folder, index) => {
    const button = document.createElement('button'); button.textContent = folder.name;
    button.onclick = async () => { if (await run('list', folder.id)) { trail = trail.slice(0, index + 1); renderTrail(); } }; trailNode.append(button);
  });
}
for (const action of ['login', 'check', 'export']) document.querySelector(`#${action}`).onclick = () => run(action);
document.querySelector('#list').onclick = () => run('list', trail.at(-1).id);
renderTrail(); run('status');
