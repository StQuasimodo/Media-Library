package io.mycinema.tv;

import android.content.Context;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Same explicit universe relations and portable overrides as desktop franchises.ts. */
final class FranchiseFolders {
    static final class Folder {final String key,title;final boolean standalone;final List<Library.Item> items=new ArrayList<>();Folder(String key,String title,boolean standalone){this.key=key;this.title=title;this.standalone=standalone;}}
    private final JSONArray rules;
    FranchiseFolders(Context context){JSONArray data;try(java.io.InputStream input=context.getAssets().open("franchises.json")){data=new JSONArray(new String(TmdbClient.read(input,65536),StandardCharsets.UTF_8));}catch(Exception error){data=new JSONArray();}rules=data;}
    JSONObject universe(Library.Item item){JSONObject series=item.film.optJSONObject("series");if(series!=null&&series.has("franchise"))return series.optJSONObject("franchise");
        if(!Json.text(item.film,"metadataSource").equals("tmdb"))return null;String id=Json.text(item.film,"externalId").split(":",-1)[0];String kind=Json.text(item.film,"mediaType");
        JSONObject direct=null;for(int i=0;i<rules.length();i++){JSONObject rule=rules.optJSONObject(i);if(rule==null)continue;JSONArray ids=Json.array(rule,kind);for(int j=0;j<ids.length();j++)if(id.equals(ids.optString(j))){if(direct!=null&&!Json.text(direct,"key").equals(Json.text(rule,"key")))return null;direct=rule;}}
        if(direct!=null)return direct;if(!kind.equals("movie"))return null;String collection=item.seriesKey().startsWith("tmdb:collection:")?item.seriesKey().substring("tmdb:collection:".length()):"";JSONObject match=null;
        for(int i=0;i<rules.length();i++){JSONObject rule=rules.optJSONObject(i);if(rule==null)continue;JSONArray ids=Json.array(rule,"collections");for(int j=0;j<ids.length();j++)if(collection.equals(ids.optString(j))){if(match!=null&&!Json.text(match,"key").equals(Json.text(rule,"key")))return null;match=rule;}}if(match!=null)return match;
        JSONObject related=series==null?null:series.optJSONObject("relatedTv");if(related==null||!Json.text(related,"source").equals("tmdb-evidence-v1")||!Json.text(related,"tvId").matches("[0-9]+")||related.optInt("score")<70)return null;
        String tvId=Json.text(related,"tvId");for(int i=0;i<rules.length();i++){JSONObject rule=rules.optJSONObject(i);if(rule==null)continue;JSONArray tv=Json.array(rule,"tv");for(int j=0;j<tv.length();j++)if(tvId.equals(tv.optString(j)))return rule;}
        JSONObject root=new JSONObject();Json.put(root,"key","tmdb:tv:"+tvId);Json.put(root,"title",Json.text(related,"title"));return root;}
    String key(Library.Item item){JSONObject root=universe(item);return root!=null?Json.text(root,"key"):item.seriesKey().isEmpty()?"film:"+item.id():item.seriesKey();}
    List<Folder> groups(List<Library.Item> items){LinkedHashMap<String,Folder> groups=new LinkedHashMap<>();for(Library.Item item:items){JSONObject root=universe(item);String key=key(item);if(!groups.containsKey(key))groups.put(key,new Folder(key,root!=null?Json.text(root,"title"):item.seriesTitle().isEmpty()?item.title():item.seriesTitle(),root==null&&item.seriesKey().isEmpty()));groups.get(key).items.add(item);}return new ArrayList<>(groups.values());}
    static String normalized(String title){return Normalizer.normalize(title,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]","");}
    String assignmentKey(String title,List<Library.Item> items){String name=normalized(title);if(name.isEmpty())throw new IllegalArgumentException("文件夹名称须包含文字或数字。");for(Folder folder:groups(items))if(normalized(folder.title).equals(name))return folder.key;return "franchise:manual:"+name;}
}
