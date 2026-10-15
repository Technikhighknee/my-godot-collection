// The map editor only edits saved project resource references; the domain
// contracts and production pipeline own their meaning and verification.
export function mountSurfaceMaterialEditor(container,paletteInput,map,assets){
  const available=assets.filter(a=>a.kind==='image'&&!('origin' in a.source))
    .map(a=>({value:'asset:'+a.source.id,label:a.source.name+' ('+a.source.id+')'}));
  const draft=new Map(Object.entries(map.terrain.surface_materials??{}));
  function capture(){
    for(const row of container.querySelectorAll('[data-surface-definition]')){
      const surface=row.dataset.surfaceDefinition;
      const asset=row.querySelector('[data-material-ref]').value;
      if(!asset){draft.delete(surface);continue;}
      const tile_size=Number(row.querySelector('[data-tile-size]').value);
      const profile=row.querySelector('[data-material-profile]').value.trim();
      draft.set(surface,{asset,tile_size,...(profile?{profile}:{})});
    }
  }
  function render(){
    capture();
    const surfaces=[...new Set(paletteInput.value.split(/\r?\n/)
      .map(s=>s.trim()).filter(Boolean))];
    container.replaceChildren();
    for(const surface of surfaces){
      const saved=draft.get(surface);
      const row=document.createElement('div');
      row.className='surface-material-row';
      row.dataset.surfaceDefinition=surface;
      const label=document.createElement('strong');label.textContent=surface;
      const select=document.createElement('select');select.dataset.materialRef='';
      select.setAttribute('aria-label','Material for '+surface);
      const option=document.createElement('option');
      option.value='';option.textContent='Palette color (no material)';
      select.append(option);
      for(const item of available){
        const option=document.createElement('option');
        option.value=item.value;option.textContent=item.label;
        select.append(option);
      }
      if(saved&&!available.some(item=>item.value===saved.asset)){
        const unavailable=document.createElement('option');
        unavailable.value=saved.asset;
        unavailable.textContent='Unavailable: '+saved.asset;
        select.append(unavailable);
      }
      select.value=saved?.asset??'';
      const tile=document.createElement('input');
      tile.dataset.tileSize='';tile.type='number';tile.min='0.01';
      tile.max='10000';tile.step='0.25';tile.value=String(saved?.tile_size??4);
      tile.setAttribute('aria-label','Tile size in meters for '+surface);
      const profile=document.createElement('input');
      profile.dataset.materialProfile='';profile.type='text';
      profile.placeholder='Profile (if needed)';
      profile.value=saved?.profile??'';
      profile.setAttribute('aria-label','Material profile for '+surface);
      const controls=document.createElement('div');
      controls.className='surface-material-options';
      controls.append(select,tile,profile);
      row.append(label,controls);container.append(row);
    }
  }
  paletteInput.addEventListener('input',render);
  render();
  return {
    read(surfaces){
      capture();
      const bindings={};
      for(const surface of surfaces){
        const binding=draft.get(surface);
        if(!binding)continue;
        if(!Number.isFinite(binding.tile_size)||binding.tile_size<0.01||
          binding.tile_size>10000)
          throw Error('Invalid tile size for '+surface);
        if(binding.profile&&!/^[a-z][a-z0-9_-]*$/.test(binding.profile))
          throw Error('Invalid profile for '+surface);
        bindings[surface]=binding;
      }
      return bindings;
    },
  };
}
