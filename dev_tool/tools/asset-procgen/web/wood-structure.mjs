import { clamp } from './math.mjs';

// Diameter is derived after growth. A branch's cross section accounts for the
// live structure beyond it, including children attached partway along its axis.
const POWER=2.35;
const smooth=(a,b,x)=>{
  const t=clamp((x-a)/(b-a),0,1);
  return t*t*(3-2*t);
};

export function resolveWoodStructure(skeleton,recipe) {
  const branches=skeleton.branches;
  const byId=new Map(branches.map(b=>[b.id,b]));
  const children=new Map(branches.map(b=>[b.id,[]]));
  for(const b of branches) {
    if(b.parentId===null)continue;
    if(!byId.has(b.parentId))throw new Error('Invalid branch parent');
    if(!(b.parentT>=0&&b.parentT<=1))throw new Error('Invalid branch attachment');
    children.get(b.parentId).push(b);
  }
  const flux=new Map();
  function solve(b) {
    if(flux.has(b.id))return flux.get(b.id);
    const length=b.points.reduce((sum,p,i)=>i===0?sum:
      sum+Math.hypot(p[0]-b.points[i-1][0],p[1]-b.points[i-1][1],p[2]-b.points[i-1][2]),0);
    // Each terminal shoot contributes living crown area; internal axes also
    // retain a smaller continuation flow instead of becoming empty at the tip.
    const self=(b.generation===4?.50:.10)+b.vigor*(b.generation===4?.43:.12)+
      length/recipe.parameters.height*.16;
    const descendants=children.get(b.id).map(child=>({
      child,t:child.parentT,flow:solve(child).base
    }));
    const profile=[];
    const count=b.points.length-1;
    for(let i=0;i<=count;i++){
      const t=i/count;
      let value=self*(1+.22*(1-t));
      for(const entry of descendants){
        const width=clamp(1.1/count,.045,.15);
        value+=entry.flow*(1-smooth(entry.t,entry.t+width,t));
      }
      profile.push(value);
    }
    const result={base:profile[0],profile};
    flux.set(b.id,result);
    return result;
  }
  const trunk=branches.find(b=>b.parentId===null);
  if(!trunk)throw new Error('Missing trunk');
  const main=solve(trunk);
  const scale=recipe.parameters.trunkRadius/Math.pow(main.base,1/POWER);
  for(const b of branches){
    const profile=flux.get(b.id).profile;
    const last=b.points.length-1;
    b.radii=profile.map((flow,i)=>{
      const t=i/last;
      // The swept implicit field naturally rounds off the terminal tip.
      return Math.max(.0018,scale*Math.pow(flow,1/POWER));
    });
    b.structuralLoad=flux.get(b.id).base;
  }
  // A child's woody tissue must join a parent cross section at least as
  // substantial as the child's base. Correct sampling-scale undershoots with
  // a short, smoothly shouldered collar around each attachment.
  for(const child of [...branches].sort((a,b)=>b.generation-a.generation)){
    if(child.parentId===null)continue;
    const parent=byId.get(child.parentId);
    const x=child.parentT*(parent.radii.length-1);
    const first=Math.min(parent.radii.length-2,Math.floor(x));
    const alpha=x-first;
    const at=parent.radii[first]*(1-alpha)+parent.radii[first+1]*alpha;
    const target=child.radii[0]*1.035;
    if(at>=target)continue;
    for(let i=Math.max(0,first-2);i<=Math.min(parent.radii.length-1,first+3);i++){
      const distance=Math.abs(i-x);
      const influence=distance<=1?1:Math.max(0,2.25-distance)/1.25;
      parent.radii[i]=Math.max(parent.radii[i],target*influence);
    }
  }
  return skeleton;
}
