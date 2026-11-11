/** Explicitly memory-only image response. Neither Node fetch nor this service has a disk cache. */
export async function transientImage(request:Request, fetcher:typeof fetch=fetch):Promise<Response> {
  const url=new URL(request.url);
  if(request.method!=='GET'||url.hostname!=='transient'||url.search||url.hash||!/^\/[A-Za-z0-9_-]{1,180}\.(jpg|png|webp)$/.test(url.pathname)) return new Response('',{status:400});
  const headers={'cache-control':'no-store, max-age=0','pragma':'no-cache'};
  try {
    const response=await fetcher(`https://image.tmdb.org/t/p/w780${url.pathname}`,{cache:'no-store',redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)])});
    if(!response.ok||!/^image\/(jpeg|png|webp)(;|$)/.test(response.headers.get('content-type')??'')||!response.body) return new Response('',{status:502,headers});
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>8*1024*1024)throw new Error('Image too large');chunks.push(next.value);}}
    finally {await reader.cancel().catch(()=>{});}
    const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
    return new Response(data,{headers:{...headers,'content-type':response.headers.get('content-type')!}});
  }catch{return new Response('',{status:502,headers});}
}
