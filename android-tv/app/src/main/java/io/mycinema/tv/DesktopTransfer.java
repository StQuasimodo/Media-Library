package io.mycinema.tv;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONObject;

/** Windows JSON -> TV data. No Windows database, images or login store is opened. */
final class DesktopTransfer {
    private static final int MAX_ROWS=10000;
    static boolean matches(JSONObject value){return Json.text(value,"format").equals("my-cinema-export");}
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("电脑迁移文件内容无效或引用不完整，原数据未更改。");}
    private static JSONArray rows(JSONObject data,String key){JSONArray rows=data.optJSONArray(key);if(rows==null||rows.length()>MAX_ROWS)throw invalid();return rows;}
    private static JSONObject row(JSONArray rows,int index)throws Exception{JSONObject row=rows.optJSONObject(index);if(row==null)throw invalid();return row;}
    private static String text(JSONObject row,String key,int max,boolean required){Object value=row.opt(key);if(value!=null&&value!=JSONObject.NULL&&!(value instanceof String))throw invalid();String result=Json.text(row,key);if(result.length()>max||result.indexOf('\0')>=0||required&&result.trim().isEmpty())throw invalid();return result;}
    private static String id(JSONObject row,String key){String id=text(row,key,256,true);if(id.contains("\n")||id.contains("\r"))throw invalid();return id;}
    private static String fid(JSONObject row,String key,boolean required){String value=text(row,key,1024,required);if(value.contains("://")||value.contains("\n")||value.contains("\r"))throw invalid();return value;}
    private static long integer(JSONObject row,String key){Object value=row.opt(key);if(!(value instanceof Integer)&&!(value instanceof Long))throw invalid();long number=((Number)value).longValue();if(number<0||number>9007199254740991L)throw invalid();return number;}
    private static void unique(Set<String> values,String id){if(!values.add(id))throw invalid();}
    private static void copy(JSONObject from,JSONObject to,String...keys){for(String key:keys)if(from.has(key))Json.put(to,key,from.opt(key));}
    private static String topicName(String value){StringBuilder result=new StringBuilder(value.length());for(int n=0;n<value.length();n++){char c=value.charAt(n);result.append(c>='A'&&c<='Z'?(char)(c+32):c);}return result.toString();}
    private static String identity(JSONObject film){String external=Json.text(film,"externalId");return external.isEmpty()?"":Json.text(film,"mediaType")+":"+external;}
    private static JSONObject series(JSONObject source){
        if(source==null)return null;
        text(source,"key",1024,true);text(source,"title",500,true);Object order=source.opt("order");if(order!=null&&order!=JSONObject.NULL&&(!(order instanceof Number)||((Number)order).doubleValue()!=((Number)order).intValue()||((Number)order).intValue()<-1))throw invalid();
        JSONObject result=new JSONObject();copy(source,result,"key","title","order");
        if(source.has("customOrder")){if(!(source.opt("customOrder") instanceof Boolean))throw invalid();copy(source,result,"customOrder");}
        for(String key:new String[]{"franchise","relatedTv","relationshipHints"}){
            JSONObject value=source.optJSONObject(key);if(value==null)continue;JSONObject clean=new JSONObject();
            if(key.equals("franchise")){text(value,"key",1024,true);text(value,"title",500,true);copy(value,clean,"key","title");}
            else if(key.equals("relatedTv")){text(value,"tvId",100,true);text(value,"title",500,true);text(value,"source",100,true);if(!(value.opt("score") instanceof Number))throw invalid();JSONArray evidence=rows(value,"evidence");for(int n=0;n<evidence.length();n++)if(!(evidence.opt(n) instanceof String)||evidence.optString(n).length()>1000)throw invalid();copy(value,clean,"tvId","title","source","score","evidence");}
            else for(String field:new String[]{"cast","creators","keywords"}){JSONArray list=rows(value,field);for(int n=0;n<list.length();n++)if(field.equals("keywords")?!(list.opt(n) instanceof String)||list.optString(n).length()>1000:!(list.opt(n) instanceof Number))throw invalid();Json.put(clean,field,list);}
            Json.put(result,key,clean);
        }
        return result;
    }
    private static JSONObject film(JSONObject raw){
        id(raw,"id");text(raw,"title",500,true);String type=text(raw,"mediaType",10,true),source=text(raw,"metadataSource",20,true),external=text(raw,"externalId",256,false);
        if(!type.equals("movie")&&!type.equals("tv")||!source.equals("manual")&&!source.equals("tmdb"))throw invalid();
        if(source.equals("tmdb")&&!external.matches("[0-9]+(?::season:[0-9]+)?"))throw invalid();
        for(String key:new String[]{"originalTitle","tagline"})text(raw,key,2000,false);text(raw,"overview",50000,false);
        for(String key:new String[]{"year","runtime"})if(!raw.isNull(key)&&raw.has(key)){long n=integer(raw,key);if(n>100000)throw invalid();}
        for(String key:new String[]{"createdAt","updatedAt","metadataUpdatedAt","originalLanguage"})text(raw,key,100,false);
        JSONArray genres=rows(raw,"genres");for(int n=0;n<genres.length();n++)if(!(genres.opt(n) instanceof String)||genres.optString(n).length()>100)throw invalid();
        JSONObject result=new JSONObject();copy(raw,result,"id","title","originalTitle","tagline","year","runtime","overview","mediaType","metadataSource","externalId","genres","originalLanguage","createdAt","updatedAt","metadataUpdatedAt");
        if(raw.has("series")&&!raw.isNull("series")&&raw.optJSONObject("series")==null)throw invalid();Json.put(result,"series",series(raw.optJSONObject("series")));Json.put(result,"posterPath",null);Json.put(result,"backdropPath",null);return result;
    }
    private static JSONObject entry(JSONObject raw){
        id(raw,"id");id(raw,"filmId");String status=text(raw,"watchStatus",20,true);if(!java.util.Arrays.asList("want","watching","watched","dropped").contains(status))throw invalid();
        Object rating=raw.opt("personalRating");if(rating!=null&&rating!=JSONObject.NULL){if(!(rating instanceof Number))throw invalid();double n=((Number)rating).doubleValue();if(Double.isNaN(n)||Double.isInfinite(n)||n<0||n>10)throw invalid();}
        text(raw,"favoriteReason",2000,false);text(raw,"personalReview",5000,false);for(String key:new String[]{"collectedAt","watchedAt","createdAt","updatedAt"})text(raw,key,100,false);
        JSONObject result=new JSONObject();copy(raw,result,"id","filmId","personalRating","watchStatus","favoriteReason","personalReview","collectedAt","watchedAt","createdAt","updatedAt","sortOrder");if(!result.has("personalRating"))Json.put(result,"personalRating",null);return result;
    }
    private static JSONObject collection(JSONObject raw){id(raw,"id");text(raw,"name",200,true);text(raw,"description",10000,false);JSONObject result=new JSONObject();copy(raw,result,"id","name","description","sortOrder","createdAt","updatedAt");Json.put(result,"coverPath",null);return result;}
    private static JSONObject resource(JSONObject raw){
        id(raw,"id");id(raw,"filmId");if(!text(raw,"provider",20,true).equals("quark"))throw invalid();text(raw,"resourceName",500,true);
        String share=text(raw,"shareUrl",8192,true);HttpUrl url=HttpUrl.parse(share);if(url==null||!url.username().isEmpty()||!url.password().isEmpty())throw invalid();
        for(String key:new String[]{"accessCode","qualityLabel","versionLabel","subtitleLabel","audioLabel","notes"})text(raw,key,10000,false);
        JSONObject result=new JSONObject();copy(raw,result,"id","filmId","provider","resourceName","shareUrl","accessCode","qualityLabel","versionLabel","subtitleLabel","audioLabel","notes","createdAt","updatedAt");Json.put(result,"availabilityStatus","unchecked");return result;
    }
    static void validate(JSONObject data)throws Exception{
        if(!matches(data)||integer(data,"formatVersion")!=2)throw new IllegalArgumentException("请在新版电脑端使用“导出到电视”，普通JSON存档不含完整匹配与忽略记录。");
        Set<String> films=new HashSet<>(),entries=new HashSet<>(),entryFilms=new HashSet<>(),topics=new HashSet<>(),resources=new HashSet<>(),external=new HashSet<>();
        JSONArray list=rows(data,"films");for(int i=0;i<list.length();i++){JSONObject f=film(row(list,i));unique(films,id(f,"id"));String key=identity(f);if(!key.isEmpty())unique(external,key);}
        list=rows(data,"collectionEntries");for(int i=0;i<list.length();i++){JSONObject e=entry(row(list,i));unique(entries,id(e,"id"));String key=id(e,"filmId");if(!films.contains(key))throw invalid();unique(entryFilms,key);}if(!entryFilms.equals(films))throw invalid();
        list=rows(data,"collections");Set<String> names=new HashSet<>();for(int i=0;i<list.length();i++){JSONObject c=collection(row(list,i));unique(topics,id(c,"id"));unique(names,topicName(Json.text(c,"name")));}
        list=rows(data,"collectionFilms");Set<String> members=new HashSet<>();for(int i=0;i<list.length();i++){JSONObject m=row(list,i);String c=id(m,"collectionId"),e=id(m,"entryId");if(!topics.contains(c)||!entries.contains(e))throw invalid();unique(members,c+"\0"+e);}
        list=rows(data,"mediaResources");for(int i=0;i<list.length();i++){JSONObject r=resource(row(list,i));unique(resources,id(r,"id"));if(!films.contains(id(r,"filmId")))throw invalid();}
        JSONObject transfer=data.optJSONObject("quarkTransfer");if(transfer==null||integer(transfer,"version")!=1)throw invalid();list=rows(transfer,"files");Set<String> files=new HashSet<>();
        for(int i=0;i<list.length();i++){JSONObject f=row(list,i);unique(files,fid(f,"fileId",true));fid(f,"rootId",true);fid(f,"parent",false);text(f,"name",16384,true);integer(f,"size");if(!(f.opt("ignored") instanceof Boolean))throw invalid();String target=text(f,"filmId",256,false);if(!target.isEmpty()&&!films.contains(target)||f.optBoolean("ignored")&&!target.isEmpty()||!f.optBoolean("ignored")&&target.isEmpty())throw invalid();}
    }
    private static LinkedHashMap<String,JSONObject> index(JSONObject data,String name)throws Exception{LinkedHashMap<String,JSONObject> result=new LinkedHashMap<>();JSONArray rows=rows(data,name);for(int n=0;n<rows.length();n++){JSONObject r=row(rows,n);uniqueKey(result,id(r,"id"),r);}return result;}
    private static void uniqueKey(Map<String,JSONObject> values,String key,JSONObject value){if(values.put(key,value)!=null)throw invalid();}
    private static JSONArray array(Map<String,JSONObject> values){return new JSONArray(values.values());}
    private static void limit(Map<String,JSONObject> values){if(values.size()>MAX_ROWS)throw new IllegalArgumentException("合并后的记录超过电视端10000条上限，原数据未更改。");}
    /** Computer records win only on a matching stable work identity; TV-only data remains. */
    static JSONObject merge(JSONObject input,JSONObject current)throws Exception{
        validate(input);JSONObject old=current.getJSONObject("collection");
        LinkedHashMap<String,JSONObject> films=index(old,"films"),entries=index(old,"entries"),topics=index(old,"collections"),resources=index(old,"resources");
        Map<String,String> external=new HashMap<>(),filmIds=new HashMap<>(),entryIds=new HashMap<>(),topicIds=new HashMap<>(),entryByFilm=new HashMap<>(),topicByName=new HashMap<>();
        for(JSONObject f:films.values())if(!identity(f).isEmpty())external.put(identity(f),id(f,"id"));for(JSONObject e:entries.values())entryByFilm.put(id(e,"filmId"),id(e,"id"));for(JSONObject c:topics.values())topicByName.put(topicName(Json.text(c,"name")),id(c,"id"));
        JSONArray list=input.getJSONArray("films");for(int n=0;n<list.length();n++){
            JSONObject f=film(row(list,n));String original=id(f,"id"),key=identity(f),target=key.isEmpty()?original:external.containsKey(key)?external.get(key):original;JSONObject previous=films.get(target);
            if(previous!=null&&!identity(previous).equals(key))throw invalid();filmIds.put(original,target);Json.put(f,"id",target);
            if(previous!=null){Json.put(f,"posterPath",previous.opt("posterPath"));Json.put(f,"backdropPath",previous.opt("backdropPath"));}films.put(target,f);if(!key.isEmpty())external.put(key,target);
        }
        list=input.getJSONArray("collectionEntries");for(int n=0;n<list.length();n++){
            JSONObject e=entry(row(list,n));String original=id(e,"id"),film=filmIds.get(id(e,"filmId")),target=entryByFilm.containsKey(film)?entryByFilm.get(film):original;
            if(entries.containsKey(target)&&!Json.text(entries.get(target),"filmId").equals(film))throw invalid();entryIds.put(original,film);Json.put(e,"id",target);Json.put(e,"filmId",film);entries.put(target,e);
        }
        list=input.getJSONArray("collections");for(int n=0;n<list.length();n++){
            JSONObject c=collection(row(list,n));String original=id(c,"id"),name=topicName(Json.text(c,"name")),target=topics.containsKey(original)?original:topicByName.containsKey(name)?topicByName.get(name):original;
            if(topicByName.containsKey(name)&&!topicByName.get(name).equals(target))throw invalid();topicIds.put(original,target);Json.put(c,"id",target);topics.put(target,c);topicByName.put(name,target);
        }
        list=input.getJSONArray("mediaResources");for(int n=0;n<list.length();n++){JSONObject r=resource(row(list,n));String key=id(r,"id"),film=filmIds.get(id(r,"filmId"));if(resources.containsKey(key)&&!Json.text(resources.get(key),"filmId").equals(film))throw invalid();Json.put(r,"filmId",film);resources.put(key,r);}
        LinkedHashMap<String,JSONObject> members=new LinkedHashMap<>();list=old.getJSONArray("members");for(int n=0;n<list.length();n++){JSONObject m=row(list,n);members.put(id(m,"collectionId")+"\0"+id(m,"filmId"),m);}
        list=input.getJSONArray("collectionFilms");for(int n=0;n<list.length();n++){JSONObject m=row(list,n),clean=new JSONObject();String topic=topicIds.get(id(m,"collectionId")),film=entryIds.get(id(m,"entryId"));Json.put(clean,"collectionId",topic);Json.put(clean,"filmId",film);members.put(topic+"\0"+film,clean);}
        for(Map<String,JSONObject> values:java.util.Arrays.asList(films,entries,topics,resources,members))limit(values);
        JSONObject collection=new JSONObject();Json.put(collection,"format","my-cinema-tv-backup");Json.put(collection,"formatVersion",1);Json.put(collection,"films",array(films));Json.put(collection,"entries",array(entries));Json.put(collection,"collections",array(topics));Json.put(collection,"resources",array(resources));Json.put(collection,"members",array(members));
        JSONObject media=current.getJSONObject("media");LinkedHashMap<String,JSONObject> files=new LinkedHashMap<>();list=media.getJSONArray("files");for(int n=0;n<list.length();n++){JSONObject f=row(list,n);files.put(Json.text(f,"key"),f);}
        list=input.getJSONObject("quarkTransfer").getJSONArray("files");for(int n=0;n<list.length();n++){
            JSONObject original=row(list,n),f=new JSONObject(),match=new JSONObject();String key="quark:"+Json.text(original,"fileId"),target=Json.text(original,"filmId");
            Json.put(f,"key",key);Json.put(f,"source","quark");copy(original,f,"fileId","parent","name","size","ignored");Json.put(f,"filmId","");Json.put(f,"associationManual",true);
            Json.put(match,"rootId",Json.text(original,"rootId"));Json.put(match,"filmId",target.isEmpty()?"":filmIds.get(target));Json.put(match,"pending",true);Json.put(f,"desktopMatch",match);files.put(key,f);
        }
        limit(files);JSONObject migratedMedia=new JSONObject();Json.put(migratedMedia,"files",array(files));Json.put(migratedMedia,"progress",media.getJSONArray("progress"));
        JSONObject result=new JSONObject();Json.put(result,"format","my-cinema-tv-backup");Json.put(result,"formatVersion",4);Json.put(result,"collection",collection);Json.put(result,"media",migratedMedia);Json.put(result,"cloudProgress",current.getJSONArray("cloudProgress"));return result;
    }
}
