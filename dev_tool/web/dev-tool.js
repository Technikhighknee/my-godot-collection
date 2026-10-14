const byId=id=>document.getElementById(id);
const list=byId('projectList'),count=byId('projectCount'),alert=byId('alert');
const form=byId('createForm'),name=byId('projectName'),id=byId('projectId');
let autoId=true;
function issue(message){alert.textContent=message;alert.hidden=!message;}
async function api(path,options){
  const response=await fetch(path,{cache:'no-store',...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'HTTP '+response.status);
  return data;
}
function projectCard(project,activeId){
  const item=document.createElement('button');
  item.type='button';item.className='project';
  const icon=document.createElement('span');icon.className='icon';icon.textContent='◇';
  const title=document.createElement('strong');title.textContent=project.name;
  const footer=document.createElement('span');footer.className='meta';
  const slug=document.createElement('small');slug.textContent=project.id;
  footer.append(slug);
  if(project.id===activeId){const active=document.createElement('span');active.className='active';active.textContent='ACTIVE';footer.append(active);}
  item.append(icon,title,footer);
  item.setAttribute('aria-label','Open '+project.name);
  item.addEventListener('click',async()=>{
    item.disabled=true;issue('');
    try{
      if(project.id!==activeId)await api('/api/projects/active',{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:project.id}),
      });
      location.assign('/studio.html');
    }catch(e){item.disabled=false;issue(e.message);}
  });
  return item;
}
async function refresh(){
  try{
    const {projects,active}=await api('/api/projects');
    list.replaceChildren(...projects.map(p=>projectCard(p,active?.id)));
    if(!projects.length){
      const empty=document.createElement('div');empty.className='empty';
      empty.textContent='No projects yet. Create one below to start.';
      list.append(empty);
    }
    count.textContent=projects.length+' PROJECT'+(projects.length===1?'':'S');
  }catch(e){
    form.hidden=true;list.replaceChildren();count.textContent='';
    byId('legacy').hidden=false;issue('Project browser unavailable in legacy map mode.');
  }
}
name.addEventListener('input',()=>{
  if(autoId)id.value=name.value.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/g,'-')
    .replace(/^-+|-+$/g,'').slice(0,48);
});
id.addEventListener('input',()=>{autoId=false;});
form.addEventListener('submit',async(event)=>{
  event.preventDefault();issue('');
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{
    await api('/api/projects',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:id.value.trim(),name:name.value.trim()})});
    location.assign('/studio.html');
  }catch(e){button.disabled=false;issue(e.message);}
});
await refresh();
