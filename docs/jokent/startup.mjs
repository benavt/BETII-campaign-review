// A blocked embedded-browser storage request must not keep the interface blank.
export function settleWithin(operation,{timeoutMs=4000,message='Browser storage did not respond. Existing saved data was preserved.'}={}){
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeoutMs);}),
  ]).finally(()=>clearTimeout(timer));
}
export function setStartupMessage(document,message){
  const node=document.getElementById('startup-message');if(node)node.textContent=message;
}
export function publicationOptions({dataset={},href}){
  const url=new URL(href);
  if(dataset.workspaceMode!=='published'||url.searchParams.get('demo')==='1')return {published:false};
  const id=dataset.publicationId;
  if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))throw new Error('Published reviews require an explicit safe publication identity.');
  const storageKey='campaign-studio-published-'+id;
  return {published:true,storageKey,importKey:storageKey+':import',importView:url.searchParams.get('workspace')==='import',workspacePath:'./data/published-workspace.json'};
}
// An explicit private campaign link must not open an unrelated import or demo.
// This only selects source data; it never rewrites the saved browser workspace.
export async function resolveStartupWorkspace({href,saved,runtime,stored={},connect,demo,published=false}){
  const url=new URL(href),forceDemo=url.searchParams.get('demo')==='1',requested=url.searchParams.get('campaign');
  const privateExpected=runtime?.privateWorkspaceAvailable===true||['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  let workspace=saved?.workspace,mode=saved?.mode||'demo';
  if(!forceDemo&&(published||privateExpected)&&(published||mode!=='imported'||requested)){
    try{workspace=await connect(stored);mode=published?'published':'cache';}
    catch(error){throw new Error((published?'Published review data could not be opened. ':'Private campaign data could not be opened. ')+(error?.message||'Check the campaign service and reload.'));}
  }else workspace||=demo();
  if(requested&&!workspace.campaigns.some(c=>c.id===requested))throw new Error('The requested campaign "'+requested+'" is not available in this workspace. Check the campaign service or restore the matching workspace.');
  return {workspace,mode};
}
export async function loadApplication({root,importApplication,reload}){
  try{const application=await importApplication();await application.ready;}
  catch(error){
    root.replaceChildren();root.removeAttribute('aria-busy');
    const document=root.ownerDocument,section=document.createElement('section');section.className='startup-status';section.setAttribute('role','alert');
    const heading=document.createElement('h1');heading.textContent='Campaign Studio could not finish loading';
    const detail=document.createElement('p');detail.textContent=error?.message||'The application could not be opened.';
    const button=document.createElement('button');button.type='button';button.textContent='Reload campaign';button.addEventListener('click',reload);
    section.append(heading,detail,button);
    if(typeof error?.openSavedImport==='function'){
      const open=document.createElement('button');open.type='button';open.textContent='Open saved import';open.addEventListener('click',error.openSavedImport);section.append(open);
    }
    root.append(section);
    return {status:'failed',message:detail.textContent};
  }
  return {status:'ready'};
}
