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
export async function loadApplication({root,importApplication,reload}){
  try{const application=await importApplication();await application.ready;}
  catch(error){
    root.replaceChildren();root.removeAttribute('aria-busy');
    const document=root.ownerDocument,section=document.createElement('section');section.className='startup-status';section.setAttribute('role','alert');
    const heading=document.createElement('h1');heading.textContent='Campaign Studio could not finish loading';
    const detail=document.createElement('p');detail.textContent=error?.message||'The application could not be opened.';
    const button=document.createElement('button');button.type='button';button.textContent='Reload campaign';button.addEventListener('click',reload);
    section.append(heading,detail,button);root.append(section);
    return {status:'failed',message:detail.textContent};
  }
  return {status:'ready'};
}
