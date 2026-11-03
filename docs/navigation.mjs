// One navigation drawer, shared across touch, keyboard and pointer layouts.
function bindCampaignMenu(root){
  const close=event=>{
    const more=root.querySelector('.campaign-more[open]');
    if(!more)return;
    if(event.type==='keydown'&&event.key==='Escape'){event.preventDefault();more.open=false;more.querySelector('summary').focus();}
    if(event.type==='click'&&!more.contains(event.target))more.open=false;
  };
  document.addEventListener('keydown',close);document.addEventListener('click',close);
  return ()=>{document.removeEventListener('keydown',close);document.removeEventListener('click',close);};
}
export function bindCampaignNavigation(root=document,{initialOpen=false}={}) {
  const disposeMenu=bindCampaignMenu(root);
  const panel=root.querySelector('#campaign-navigation'), workspace=root.querySelector('.workspace');
  const toggle=root.querySelector('[data-mobile-nav="toggle"]');
  if(!panel||!toggle)return disposeMenu;
  const media=matchMedia('(max-width: 850px)');
  const focusable=()=>[...panel.querySelectorAll('button,a,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
  const setOpen=(open,restore=false)=>{
    open=media.matches&&open;
    document.body.dataset.navOpen=String(open);
    toggle.setAttribute('aria-expanded',String(open));
    panel.inert=media.matches&&!open;
    workspace.inert=open;
    if(open){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');focusable()[0]?.focus();}
    else{panel.removeAttribute('role');panel.removeAttribute('aria-modal');if(restore)toggle.focus();}
  };
  toggle.onclick=()=>setOpen(document.body.dataset.navOpen!=='true',true);
  root.querySelectorAll('[data-mobile-nav="close"]').forEach(button=>button.onclick=()=>setOpen(false,true));
  panel.addEventListener('click',event=>{if(event.target.closest('[data-campaign],[data-action]'))setOpen(false);});
  const onKey=event=>{
    if(document.body.dataset.navOpen!=='true')return;
    if(event.key==='Escape'){event.preventDefault();setOpen(false,true);}
    if(event.key==='Tab'){const nodes=focusable();if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  };
  document.addEventListener('keydown',onKey);
  const onResize=()=>setOpen(false);media.addEventListener('change',onResize);
  setOpen(initialOpen);
  return ()=>{disposeMenu();document.removeEventListener('keydown',onKey);media.removeEventListener('change',onResize);};
}
