package io.mycinema.tv;

import org.json.JSONObject;

/** Explicit one-shot refill; no network is required to import a collection. */
final class TransferArtwork {
    interface Loader {JSONObject load(JSONObject film)throws Exception;}
    interface Cancellation {void check()throws Exception;}
    static int[] fill(Library library,Loader loader,Cancellation cancellation)throws Exception{
        int filled=0,failed=0,unavailable=0,consecutive=0,paused=0;
        for(Library.Item item:library.list("","","","","recent")){
            cancellation.check();if(!Json.text(item.film,"metadataSource").equals("tmdb"))continue;
            if(!Json.text(item.film,"posterPath").isEmpty()&&!Json.text(item.film,"backdropPath").isEmpty())continue;
            try{
                JSONObject loaded=loader.load(item.film);cancellation.check();Library.Item current=library.get(item.id());boolean changed=false;
                if(!Json.text(current.film,"externalId").equals(Json.text(item.film,"externalId"))||!Json.text(current.film,"mediaType").equals(Json.text(item.film,"mediaType")))continue;
                for(String kind:new String[]{"poster","backdrop"})if(Json.text(current.film,kind+"Path").isEmpty()&&!Json.text(loaded,kind+"Path").isEmpty()){
                    library.setArtwork(item.id(),kind,Json.text(loaded,kind+"Path"));changed=true;
                }
                if(changed)filled++;else unavailable++;consecutive=0;
            }catch(InterruptedException stopped){throw stopped;}catch(Exception error){failed++;if(++consecutive>=3){paused=1;break;}}
        }
        return new int[]{filled,failed,unavailable,paused};
    }
}
