'use strict';
/* STL einlesen und Überhänge analysieren – aus v4, ohne DOM-Zugriffe. */
function parseSTL(name,buf){
  const bytes=new Uint8Array(buf), dv=new DataView(buf);
  let pos;
  const declared=bytes.length>=84?dv.getUint32(80,true):0;
  const binaryExpected=84+declared*50;
  const looksBinary=bytes.length>=84&&declared>0&&bytes.length>=binaryExpected;
  if(looksBinary){
    pos=new Float32Array(declared*9);
    for(let i=0,p=84;i<declared;i++,p+=50){for(let j=0;j<9;j++)pos[i*9+j]=dv.getFloat32(p+12+j*4,true)}
  }else{
    const text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
    const re=/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/gi;const arr=[];let m;
    while((m=re.exec(text)))arr.push(+m[1],+m[2],+m[3]);
    arr.length-=arr.length%9; pos=new Float32Array(arr);
  }
  const n=pos.length/9;
  if(!n)throw Error('Keine gültigen Dreiecke gefunden');
  let mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<pos.length;i+=3){for(let k=0;k<3;k++){const v=pos[i+k];if(v<mn[k])mn[k]=v;if(v>mx[k])mx[k]=v}}
  // per-face data: overhang angle from vertical (90 = flat ceiling, 0 = wall, <0 = faces up), area, "on bed"
  const ang=new Float32Array(n), area=new Float32Array(n), bed=new Uint8Array(n);
  let vol=0,total=0;
  const bedTol=0.2; // everything within the first layer counts as resting on the bed
  for(let i=0;i<n;i++){
    const o=i*9;
    const ax=pos[o],ay=pos[o+1],az=pos[o+2],bx=pos[o+3],by=pos[o+4],bz=pos[o+5],cx=pos[o+6],cy=pos[o+7],cz=pos[o+8];
    const ux=bx-ax,uy=by-ay,uz=bz-az,wx=cx-ax,wy=cy-ay,wz=cz-az;
    const nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx;
    const len=Math.hypot(nx,ny,nz);
    area[i]=len/2; total+=len/2;
    const z=len?nz/len:0;
    ang[i]=90-Math.acos(Math.max(-1,Math.min(1,-z)))*180/Math.PI;
    bed[i]=Math.max(az,bz,cz)<=mn[2]+bedTol?1:0;
    vol+=(ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6;
  }
  let bedArea=0;for(let i=0;i<n;i++)if(bed[i]&&ang[i]>80)bedArea+=area[i];
  return {name,pos,n,ang,area,bed,total,bedArea,vol:Math.abs(vol),x:mx[0]-mn[0],y:mx[1]-mn[1],z:mx[2]-mn[2],mn,mx};
}

function analyze(geom,th){
  if(!geom)return null;
  let flagged=0,ceiling=0;
  for(let i=0;i<geom.n;i++){
    if(geom.bed[i])continue;
    const a=geom.ang[i];
    if(a>th)flagged+=geom.area[i];
    if(a>80)ceiling+=geom.area[i];
  }
  const ratio=flagged/Math.max(1,geom.total);
  let level;
  if(flagged<30||ratio<0.002)level='none';
  else if(flagged<Math.max(300,0.03*geom.total))level='few';
  else level='needed';
  return {th,flagged,ceiling,ratio,level};
}
