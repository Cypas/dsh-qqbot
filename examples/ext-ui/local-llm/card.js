/* 卡片脚本 —— 以 new Function('qqbotExt', 'shadowRoot', 源码) 执行。
   所以这两个变量可以直接用，不需要 import：

     qqbotExt     { extId, api(path, opts), toast(msg) }
     shadowRoot   本卡片的 ShadowRoot（用 shadowRoot.getElementById 查节点）

   ⚠️ 不要用 document.getElementById —— 那查到的是外面的页面，不是这张卡。
   ⚠️ 脚本抛错只会让这张卡显示一行红字，不会影响设置页其他部分（外面有 try/catch）。
*/
(function () {
  var $ = function (id) { return shadowRoot.getElementById(id) };

  var dot = $('dot');
  var st = $('st');
  var on = $('on');

  /** 更新状态显示 */
  function show(state, text) {
    if (dot) {
      dot.className = 'dot ' + (state === 'on' ? 'on' : state === 'err' ? 'err' : 'off');
    }
    if (st) st.textContent = text;
  }

  /** 调自己注册的接口：/api/ext/<extId>/xxx（本示例假定扩展自己注册了 status）
   *  没注册也没关系 —— 会拿到 null，然后显示"接口未实现" */
  function loadStatus() {
    show('off', '读取中…');
    qqbotExt.api('/status').then(function (j) {
      if (!j) return show('off', '接口未实现（这是示例卡片）');
      show(j.up ? 'on' : 'off', j.up ? '运行中' : '未运行');
      if (on && typeof j.enabled === 'boolean') on.checked = j.enabled;
    }).catch(function () {
      show('err', '接口调用失败');
    });
  }

  if (on) {
    on.addEventListener('change', function () {
      // 真实扩展这里应该 POST 自己的配置；示例只做个提示
      qqbotExt.toast('示例卡片：这里应保存「' + (on.checked ? '启用' : '停用') + '」');
    });
  }

  var ping = $('ping');
  if (ping) {
    ping.addEventListener('click', function () {
      ping.disabled = true;
      qqbotExt.api('/ping').then(function (j) {
        qqbotExt.toast(j ? '通了：' + JSON.stringify(j) : '扩展还没有 /ping 接口');
      }).finally(function () { ping.disabled = false; });
    });
  }

  var refresh = $('refresh');
  if (refresh) refresh.addEventListener('click', loadStatus);

  loadStatus();
})();
