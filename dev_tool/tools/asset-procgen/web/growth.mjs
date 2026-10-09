import { add,sub,scale,unit,mix,clamp,lerp,TAU,randomStream,signed } from './math.mjs';
import { OAK } from './oak.mjs';

const polar=angle=>[Math.cos(angle),0,Math.sin(angle)];
const at=(path,t)=>{
  const x=clamp(t,0,1)*(path.length-1),i=Math.min(path.length-2,Math.floor(x));
  return mix(path[i],path[i+1],x-i);
};
const directionAt=(path,t)=>{
  const a=at(path,Math.max(0,t-.045)),b=at(path,Math.min(1,t+.045));
  return unit(sub(b,a));
};
const choose=(rng,[min,max],density)=>Math.round(lerp(min,max,clamp(density,0,1))+(rng()-.5)*1.0);

function trunk(skeleton,recipe) {
  const {height:H,trunkRadius:radius,asymmetry}=recipe.parameters;
  const rnd=randomStream(recipe.seed,1,21),phase=rnd()*TAU;
  const points=[],radii=[];
  const bend=signed(rnd,.20)*H*.10*asymmetry;
  for(let i=0;i<=20;i++){
    const t=i/20,drift=bend*t*t;
    points.push([
      drift*Math.cos(phase)+Math.sin(t*4.3+phase)*H*.007*t*t,
      t*H*OAK.trunkTop,
      drift*Math.sin(phase)+Math.cos(t*3.7+phase)*H*.006*t*t
    ]);
    const flare=1+.57*Math.exp(-t*26);
    radii.push(Math.max(.008,radius*flare*Math.pow(1-t,.82)));
  }
  skeleton.branches.push({id:1,parentId:null,generation:0,points,radii,vigor:1});
  return points;
}

function appendBranch(skeleton,{id,parentId,generation,start,heading,length:span,baseRadius,vigor,seed,verticalBias,asymmetry,tilt=0}) {
  const rnd=randomStream(seed,id,31);
  const steps=[0,8,6,5,4][generation]??4;
  let pos=start,direction=unit(heading);
  const side=unit([-direction[2],0,direction[0]]);
  const points=[start],radii=[baseRadius*1.12];
  const warp=signed(rnd,1)*(.08+asymmetry*.12);
  for(let k=1;k<=steps;k++){
    const t=k/steps;
    const rise=verticalBias*(.028+.052*vigor);
    const curl=add(scale(side,warp*Math.sin(t*Math.PI*1.3)),[0,rise-tilt*.05*t,0]);
    const turn=[signed(rnd,.030),signed(rnd,.012),signed(rnd,.030)];
    const desired=unit(add(add(direction,scale(curl,.22)),turn));
    direction=unit(mix(direction,desired,.48));
    const step=span/steps*(.96+.08*Math.sin(t*3));
    pos=add(pos,scale(direction,step));
    points.push(pos);
    radii.push(Math.max(.003,baseRadius*Math.pow(1-t,1.04)*(.96+.055*Math.sin(t*6+warp))));
  }
  const branch={id,parentId,generation,points,radii,vigor};
  skeleton.branches.push(branch);
  return branch;
}

// Coarse shoot competition deliberately leaves gaps in the crown.
function crownCompetition(radius) {
  const size=Math.max(.16,radius*.22),bins=new Map();
  const cell=p=>p.map(v=>Math.floor(v/size));
  const key=(x,y,z)=>x+':'+y+':'+z;
  return {
    crowding(p) {
      const [x,y,z]=cell(p);let density=0;
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)
        density+=bins.get(key(x+dx,y+dy,z+dz))??0;
      return density;
    },
    occupy(p) {const [x,y,z]=cell(p),k=key(x,y,z);bins.set(k,(bins.get(k)??0)+1);}
  };
}
function leafAnchorsOnTwig(skeleton,branch,recipe) {
  const rnd=randomStream(recipe.seed,branch.id,97),p=recipe.parameters;
  const count=2+Math.round(lerp(1,4,p.leafDensity));
  for(let i=0;i<count;i++){
    const t=.30+(i+.35+rnd()*.3)/count*.63;
    const position=at(branch.points,clamp(t,0,1)),direction=directionAt(branch.points,t);
    const angle=i*2.399963229728653+rnd()*.65;
    const side=unit([-direction[2],0,direction[0]]),up=[0,1,0];
    const radial=unit(add(scale(side,Math.cos(angle)),scale(up,Math.sin(angle))));
    const normal=unit(add(scale(radial,.62),scale(direction,.38)));
    const size=p.crownRadius*(.105+.048*rnd())*(.85+.28*p.leafDensity);
    skeleton.leafAnchors.push({
      id:branch.id*16+i+1,branchId:branch.id,position,direction,normal,size,
      light:clamp(.55+position[1]/p.height*.43,0,1),vigor:branch.vigor
    });
  }
}
export function growOak(recipe) {
  const p=recipe.parameters,H=p.height,R=p.crownRadius;
  const tree={branches:[],leafAnchors:[]},stem=trunk(tree,recipe);
  const space=crownCompetition(R);
  const baseRnd=randomStream(recipe.seed,1,11);
  const major=choose(baseRnd,OAK.primaryCount,p.branchDensity),offset=baseRnd()*TAU;

  function sprout(parent,generation){
    if(generation>4 || tree.branches.length>=OAK.maxBranches)return;
    const baseR=parent.radii[0],rnd=randomStream(recipe.seed,parent.id,43);
    const range=generation===2?OAK.secondaryCount:generation===3?OAK.tertiaryCount:OAK.twigCount;
    const count=Math.max(1,choose(rnd,range,p.branchDensity));
    for(let j=0;j<count;j++){
      if(tree.branches.length>=OAK.maxBranches)return;
      const id=parent.id*16+j+1,r=randomStream(recipe.seed,id,47);
      const t=clamp(.28+(j+.35+r()*.45)/count*.61,.2,.91);
      const origin=at(parent.points,t),tangent=directionAt(parent.points,t);
      const left=unit([-tangent[2],0,tangent[0]]);
      const side=scale(left,(j%2===0?1:-1));
      const n=unit(add(side,scale(tangent,.18+signed(r,.25))));
      const spread=(generation===2?.74:generation===3?.53:.42)+r()*.29;
      const lift=[0,.34,.28,.39,.24][generation];
      const heading=unit(add(add(scale(tangent,.34),scale(n,spread)),[0,lift+signed(r,.07),0]));
      const lengthScale=generation===2?(.31+r()*.19):generation===3?(.16+r()*.12):(.095+r()*.07);
      const span=R*lengthScale*(.75+parent.vigor*.38);
      const radius=Math.max(generation===4?.008:.013,baseR*(generation===2?.49:generation===3?.46:.41));
      const tip=add(origin,scale(heading,span));
      const crowded=space.crowding(tip),sun=clamp((tip[1]-H*.36)/(H*.58),0,1);
      const vigor=clamp(parent.vigor*(.80+.19*r()+.13*sun)-crowded*.016,.09,1);
      if(generation>=3 && ((crowded>7 && r()<.5)||(vigor<.22 && r()<.7)))continue;
      const branch=appendBranch(tree,{
        id,parentId:parent.id,generation,start:origin,heading,length:span,
        baseRadius:radius,vigor,seed:recipe.seed,verticalBias:OAK.upwardBias[generation-1],
        asymmetry:p.asymmetry,tilt:Math.max(0,(.57-sun)*.2)
      });
      if(generation===4){
        space.occupy(at(branch.points,.86));
        if(tree.leafAnchors.length<OAK.maxAnchors)leafAnchorsOnTwig(tree,branch,recipe);
      }else sprout(branch,generation+1);
    }
  }
  for(let i=0;i<major;i++){
    const id=16+i+1,rnd=randomStream(recipe.seed,id,17);
    const phase=offset+i*2.399963229728653+signed(rnd,.21+p.asymmetry*.36);
    const position=.28+.49*(i+.34+rnd()*.5)/major;
    const origin=at(stem,position),radial=polar(phase);
    const spread=R*(.86+.35*rnd())*(1-.16*position);
    const rise=H*(.17+.15*position+signed(rnd,.025));
    const heading=unit(add(scale(radial,spread),[0,rise,0]));
    const vigor=clamp(.64+.30*rnd()+.12*(.70-position),.25,1);
    const radius=p.trunkRadius*(.51-.19*position)*(.84+.24*rnd());
    const limb=appendBranch(tree,{
      id,parentId:1,generation:1,start:origin,heading,length:Math.hypot(spread,rise),
      baseRadius:radius,vigor,seed:recipe.seed,verticalBias:.18,
      asymmetry:p.asymmetry,tilt:.24
    });
    sprout(limb,2);
  }
  return tree;
}
