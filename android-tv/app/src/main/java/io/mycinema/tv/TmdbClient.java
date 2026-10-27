package io.mycinema.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import javax.net.ssl.HttpsURLConnection;

/** Same TMDB identities, season semantics and image fallbacks as the desktop provider. */
final class TmdbClient {
    interface Transport { JSONObject get(String path,Map<String,String> params) throws Exception; }
    private final Transport transport;
    private final String language;
    private final ConcurrentHashMap<String,FutureTask<JSONObject>> galleries=new ConcurrentHashMap<>();
    private volatile long galleryRetryAt;
    private JSONObject images(String path) {
        FutureTask<JSONObject> cached=galleries.get(path);
        if(cached!=null){try{return cached.get();}catch(Exception ignored){return null;}}
        if(System.currentTimeMillis()<galleryRetryAt)return null;
        FutureTask<JSONObject> task=new FutureTask<>(()->{
            try{
                Map<String,String> params=new HashMap<>();params.put("language","en-US");params.put("include_image_language","zh,en,null");
                JSONObject result=transport.get(path+"/images",params);
                if(result.optJSONArray("posters")==null&&result.optJSONArray("backdrops")==null)throw new IllegalArgumentException("Invalid image gallery");
                return result;
            }catch(Exception ignored){galleryRetryAt=System.currentTimeMillis()+30000;return null;}
        });
        if(galleries.size()>=128)galleries.clear();
        FutureTask<JSONObject> previous=galleries.putIfAbsent(path,task);
        if(previous!=null)task=previous;else task.run();
        try{JSONObject result=task.get();if(result==null)galleries.remove(path,task);return result;}catch(Exception ignored){return null;}
    }
    TmdbClient(SecretStore secrets,String language){this.language=language;transport=(path,params)->request(secrets.read(),path,params);}
    TmdbClient(Transport transport,String language){this.transport=transport;this.language=language;}
    private JSONObject get(String path) throws Exception {Map<String,String> params=new HashMap<>();params.put("language",language);return transport.get(path,params);}
    static byte[] read(InputStream input,int maximum) throws Exception {
        try(InputStream stream=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int size;while((size=stream.read(buffer))!=-1){if(out.size()+size>maximum)throw new IllegalArgumentException("返回内容过大。");out.write(buffer,0,size);}return out.toByteArray();
        }
    }
    static JSONObject request(String key,String path,Map<String,String> params) throws Exception {
        key=key.trim();if(key.isEmpty())throw new IllegalArgumentException("请先在设置中配置TMDB API Key。");
        if(!path.matches("/[A-Za-z0-9/_]+"))throw new IllegalArgumentException("资料地址无效。");
        boolean bearer=key.startsWith("eyJ");StringBuilder query=new StringBuilder();
        for(Map.Entry<String,String> pair:params.entrySet())query.append('&').append(URLEncoder.encode(pair.getKey(),"UTF-8")).append('=').append(URLEncoder.encode(pair.getValue(),"UTF-8"));
        if(!bearer)query.append("&api_key=").append(URLEncoder.encode(key,"UTF-8"));
        for(int attempt=0;attempt<2;attempt++){
            HttpsURLConnection connection=null;
            try{
                connection=(HttpsURLConnection)new URL((attempt==0?"https://api.tmdb.org/3":"https://api.themoviedb.org/3")+path+"?"+query.substring(1)).openConnection();
                connection.setConnectTimeout(12000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("Accept","application/json");
                if(bearer)connection.setRequestProperty("Authorization","Bearer "+key);
                int status=connection.getResponseCode();
                if(status==401||status==403)throw new IllegalArgumentException("TMDB凭据无效或没有访问权限。");
                if(status==429)throw new IllegalArgumentException("TMDB请求过于频繁，请稍后重试。");
                if(status==404)throw new IllegalArgumentException("TMDB没有这项资料，可手动添加。");
                if(status!=200)throw new java.io.IOException();
                return Json.object(new String(read(connection.getInputStream(),4*1024*1024),StandardCharsets.UTF_8));
            }catch(IllegalArgumentException error){throw error;}
            catch(SocketTimeoutException error){if(attempt==1)throw new IllegalStateException("连接TMDB超时，请检查电视网络。");}
            catch(Exception error){if(attempt==1)throw new IllegalStateException("无法连接TMDB，请检查电视网络、时间与证书。",error);}
            finally{if(connection!=null)connection.disconnect();}
        }
        throw new IllegalStateException("无法连接TMDB。");
    }
    static void verifyKey(String key,String language) throws Exception {Map<String,String> params=new HashMap<>();params.put("language",language);request(key,"/configuration",params);}
    List<JSONObject> search(String query,String type) throws Exception {
        if(query.trim().isEmpty()||query.length()>200)throw new IllegalArgumentException("请输入1至200字的片名。");
        Map<String,String> params=new HashMap<>();params.put("language",language);params.put("query",query.trim());params.put("include_adult","false");
        JSONArray rows=Json.array(transport.get("/search/"+(type.equals("tv")?"tv":"movie"),params),"results");List<JSONObject> result=new ArrayList<>();
        for(int i=0;i<rows.length();i++){JSONObject raw=rows.optJSONObject(i);if(raw==null||raw.optLong("id",0)<=0)continue;
            JSONObject item=base(raw,type);Json.put(item,"externalId",String.valueOf(raw.optLong("id")));result.add(item);
        }
        // Bound optional image requests; a failed gallery never substitutes an
        // unclassified default poster. Actual metadata remains in the UI locale.
        if(result.size()>40)result=new ArrayList<>(result.subList(0,40));
        ExecutorService workers=Executors.newFixedThreadPool(4);List<Future<?>> pending=new ArrayList<>();
        try{
            for(JSONObject item:result)pending.add(workers.submit(()->{
                JSONObject gallery=images("/"+type+"/"+Json.text(item,"externalId"));
                Json.put(item,"posterUrl",image(ArtworkPolicy.poster(Json.array(gallery,"posters")),true));
            }));
            for(Future<?> work:pending)work.get();
        }finally{workers.shutdownNow();}return result;
    }
    static String image(String path,boolean poster){return path!=null&&path.matches("/[a-zA-Z0-9_.-]+")?"https://image.tmdb.org/t/p/"+(poster?"w500":"w1280")+path:null;}
    private static Object year(String date){try{return date.matches("^\\d{4}.*")?Integer.valueOf(date.substring(0,4)):null;}catch(Exception error){return null;}}
    private JSONObject base(JSONObject raw,String type){
        JSONObject item=new JSONObject();boolean tv=type.equals("tv");String title=Json.text(raw,tv?"name":"title");
        Json.put(item,"title",title);Json.put(item,"originalTitle",Json.text(raw,tv?"original_name":"original_title"));Json.put(item,"mediaType",type);
        Json.put(item,"year",year(Json.text(raw,tv?"first_air_date":"release_date")));Json.put(item,"overview",Json.text(raw,"overview"));
        Json.put(item,"posterUrl",null);Json.put(item,"backdropUrl",null);
        Json.put(item,"tagline",Json.text(raw,"tagline"));Json.put(item,"originalLanguage",Json.text(raw,"original_language"));
        Json.put(item,"runtime",tv?Json.array(raw,"episode_run_time").optInt(0,0):raw.optInt("runtime",0));Json.put(item,"metadataSource","tmdb");
        JSONArray genres=new JSONArray();for(int i=0;i<Json.array(raw,"genres").length();i++){JSONObject genre=Json.array(raw,"genres").optJSONObject(i);if(genre!=null)genres.put(Json.text(genre,"name"));}Json.put(item,"genres",genres);return item;
    }
    JSONObject seasonList(String id) throws Exception {validateId(id);JSONObject raw=get("/tv/"+id);if(raw.optJSONArray("seasons")==null||Json.text(raw,"name").isEmpty())throw new IllegalArgumentException("TMDB没有有效季列表，可手动添加。");return raw;}
    private static void validateId(String id){if(!id.matches("[1-9][0-9]{0,9}"))throw new IllegalArgumentException("TMDB标识无效。");}
    JSONObject candidate(String externalId,String type) throws Exception {
        if(!type.equals("movie")&&!type.equals("tv"))throw new IllegalArgumentException("作品类型无效。");
        String[] parts=externalId.split(":",-1);String id=parts[0];validateId(id);int season=-1;
        if(parts.length!=1){if(parts.length!=3||!type.equals("tv")||!parts[1].equals("season")||!parts[2].matches("0|[1-9][0-9]{0,3}"))throw new IllegalArgumentException("季标识无效。");season=Integer.parseInt(parts[2]);}
        String path="/"+type+"/"+id;JSONObject raw=get(path);JSONObject film=base(raw,type);
        if(Json.text(film,"title").isEmpty())throw new IllegalArgumentException("TMDB返回的片名无效。");
        Json.put(film,"externalId",externalId);Json.put(film,"metadataUpdatedAt",Json.now());
        if(season>=0){
            path+="/season/"+season;JSONObject detail=get(path);if(detail.optInt("season_number",-1)!=season)throw new IllegalArgumentException("TMDB季资料不完整。");
            String label=season==0?"特别篇":"第"+season+"季",seriesTitle=Json.text(film,"title");Json.put(film,"title",seriesTitle+" · "+label);
            String original=Json.text(film,"originalTitle");Json.put(film,"originalTitle",original.isEmpty()?null:original+" · "+label);
            Json.put(film,"year",year(Json.text(detail,"air_date")));JSONArray episodes=Json.array(detail,"episodes");for(int i=0;i<episodes.length();i++){JSONObject episode=episodes.optJSONObject(i);if(episode==null)continue;
                if(episode.optInt("runtime",0)>0){Json.put(film,"runtime",episode.optInt("runtime"));break;}
            }
            Json.put(film,"overview",overview(detail,path));Json.put(film,"series",series("tmdb:tv:"+id,seriesTitle,season));
        }else{
            Json.put(film,"overview",overview(raw,path));
            if(type.equals("tv"))Json.put(film,"series",series("tmdb:tv:"+id,Json.text(film,"title"),-1));
            else{
                JSONObject collection=raw.optJSONObject("belongs_to_collection");if(collection!=null&&collection.optLong("id",0)>0&&!Json.text(collection,"name").isEmpty()){
                    Integer order=null;try{
                        JSONArray members=Json.array(get("/collection/"+collection.optLong("id")),"parts");List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<members.length();i++)if(members.optJSONObject(i)!=null)sorted.add(members.optJSONObject(i));
                        Collections.sort(sorted,(a,b)->{String ad=Json.text(a,"release_date"),bd=Json.text(b,"release_date");return (ad.isEmpty()?"9999":ad).compareTo(bd.isEmpty()?"9999":bd);});
                        for(int i=0;i<sorted.size();i++)if(String.valueOf(sorted.get(i).optLong("id")).equals(id))order=i+1;
                    }catch(Exception ignored){/* Optional series lookup never blocks importing a film. */}
                    Json.put(film,"series",series("tmdb:collection:"+collection.optLong("id"),Json.text(collection,"name"),order));
                }
            }
        }
        JSONObject posters=images(path),backgrounds=season<0?posters:images("/tv/"+id);
        Json.put(film,"posterUrl",image(ArtworkPolicy.poster(Json.array(posters,"posters")),true));
        Json.put(film,"backdropUrl",image(ArtworkPolicy.backdrop(Json.array(backgrounds,"backdrops"),season),false));
        Json.put(film,"posterSelection",posters!=null&&posters.optJSONArray("posters")!=null?"resolved":"unavailable");
        Json.put(film,"backdropSelection",backgrounds!=null&&backgrounds.optJSONArray("backdrops")!=null?"resolved":"unavailable");
        return film;
    }
    private Object overview(JSONObject raw,String path){String text=Json.text(raw,"overview").trim();if(text.isEmpty()&&!language.equals("en-US")){try{Map<String,String> params=new HashMap<>();params.put("language","en-US");text=Json.text(transport.get(path,params),"overview").trim();}catch(Exception ignored){}}return text.isEmpty()?null:text;}
    static JSONObject series(String key,String title,Integer order){JSONObject item=new JSONObject();Json.put(item,"key",key);Json.put(item,"title",title);Json.put(item,"order",order);return item;}
}
