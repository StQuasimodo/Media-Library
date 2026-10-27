package io.mycinema.tv;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** TV-local database. Windows databases and credentials are never opened or rewritten. */
final class Library extends SQLiteOpenHelper {
    static final class Item {
        final JSONObject film, entry;
        Item(JSONObject film,JSONObject entry){this.film=film;this.entry=entry;}
        String id(){return Json.text(film,"id");}
        String title(){return Json.text(film,"title");}
        String status(){return Json.text(entry,"watchStatus");}
        String seriesKey(){JSONObject series=film.optJSONObject("series");return series==null?"":Json.text(series,"key");}
        String seriesTitle(){JSONObject series=film.optJSONObject("series");return series==null?"":Json.text(series,"title");}
        int order(){JSONObject series=film.optJSONObject("series");return series==null||series.isNull("order")?Integer.MAX_VALUE:series.optInt("order",Integer.MAX_VALUE);}
    }
    Library(Context context){super(context,"my-cinema-tv.db",null,1);getWritableDatabase();}
    @Override public void onConfigure(SQLiteDatabase db){db.setForeignKeyConstraintsEnabled(true);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE films(id TEXT PRIMARY KEY,external_key TEXT UNIQUE,json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE entries(id TEXT PRIMARY KEY,film_id TEXT NOT NULL UNIQUE REFERENCES films(id) ON DELETE CASCADE,json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE members(collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,film_id TEXT REFERENCES films(id) ON DELETE CASCADE,PRIMARY KEY(collection_id,film_id))");
        db.execSQL("CREATE TABLE resources(id TEXT PRIMARY KEY,film_id TEXT NOT NULL REFERENCES films(id) ON DELETE CASCADE,json TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){throw new IllegalStateException("收藏库版本不兼容，原数据已保留。");}
    private static ContentValues values(String id,JSONObject data){ContentValues v=new ContentValues();v.put("id",id);v.put("json",data.toString());return v;}
    private JSONObject one(String table,String id){
        try(Cursor c=getReadableDatabase().query(table,new String[]{"json"},"id=?",new String[]{id},null,null,null)){
            return c.moveToFirst()?Json.object(c.getString(0)):null;
        }
    }
    synchronized Item get(String id){
        JSONObject film=one("films",id);if(film==null)throw new IllegalArgumentException("作品不存在。");
        try(Cursor c=getReadableDatabase().rawQuery("SELECT json FROM entries WHERE film_id=?",new String[]{id})){
            if(!c.moveToFirst())throw new IllegalArgumentException("收藏记录不存在。");return new Item(film,Json.object(c.getString(0)));
        }
    }
    synchronized List<Item> list(String query,String status,String collection,String series,String sort){
        return list(query,status,collection,series,sort,0);
    }
    synchronized List<Item> list(String query,String status,String collection,String series,String sort,int year){
        List<Item> items=new ArrayList<>();String term=query.toLowerCase(LocaleCompat.ROOT);
        Set<String> membership=new HashSet<>();
        if(!collection.isEmpty())try(Cursor c=getReadableDatabase().rawQuery("SELECT film_id FROM members WHERE collection_id=?",new String[]{collection})){while(c.moveToNext())membership.add(c.getString(0));}
        try(Cursor c=getReadableDatabase().rawQuery("SELECT f.json,e.json FROM films f JOIN entries e ON e.film_id=f.id ORDER BY e.rowid DESC",null)){
            while(c.moveToNext()){
                Item item=new Item(Json.object(c.getString(0)),Json.object(c.getString(1)));
                if(!status.isEmpty()&&!status.equals(item.status()))continue;
                if(!collection.isEmpty()&&!membership.contains(item.id()))continue;
                if(!series.isEmpty()&&!series.equals(item.seriesKey()))continue;
                if(year>0&&item.film.optInt("year",0)!=year)continue;
                String haystack=item.title()+" "+Json.text(item.film,"originalTitle")+" "+Json.text(item.film,"overview")+" "+Json.text(item.entry,"favoriteReason")+" "+Json.text(item.entry,"personalReview");
                if(!term.isEmpty()&&!haystack.toLowerCase(LocaleCompat.ROOT).contains(term))continue;
                items.add(item);
            }
        }
        Comparator<Item> compare=(a,b)->Json.text(b.entry,"collectedAt").compareTo(Json.text(a.entry,"collectedAt"));
        if("collected_asc".equals(sort))compare=(a,b)->Json.text(a.entry,"collectedAt").compareTo(Json.text(b.entry,"collectedAt"));
        if("title".equals(sort)||"title_asc".equals(sort))compare=(a,b)->a.title().compareToIgnoreCase(b.title());
        if("title_desc".equals(sort))compare=(a,b)->b.title().compareToIgnoreCase(a.title());
        if("year".equals(sort)||"year_desc".equals(sort))compare=(a,b)->Integer.compare(b.film.optInt("year"),a.film.optInt("year"));
        if("year_asc".equals(sort))compare=(a,b)->Integer.compare(a.film.optInt("year"),b.film.optInt("year"));
        if("rating".equals(sort))compare=(a,b)->Double.compare(b.entry.optDouble("personalRating",-1),a.entry.optDouble("personalRating",-1));
        Collections.sort(items,compare);
        LinkedHashMap<String,List<Item>> groups=new LinkedHashMap<>();
        for(Item item:items){String key=item.seriesKey().isEmpty()?"film:"+item.id():item.seriesKey();if(!groups.containsKey(key))groups.put(key,new ArrayList<>());groups.get(key).add(item);}
        items.clear();for(List<Item> group:groups.values()){Collections.sort(group,(a,b)->Integer.compare(a.order(),b.order()));items.addAll(group);}return items;
    }
    synchronized Item saveCandidate(JSONObject candidate){
        String external=Json.text(candidate,"externalId"),type=Json.text(candidate,"mediaType");
        String externalKey=external.isEmpty()?null:type+":"+external;
        if(externalKey!=null)try(Cursor c=getReadableDatabase().rawQuery("SELECT id FROM films WHERE external_key=?",new String[]{externalKey})){if(c.moveToFirst())return get(c.getString(0));}
        String title=Json.text(candidate,"title").trim();if(title.isEmpty()||title.length()>300)throw new IllegalArgumentException("请输入有效片名。");
        if(!type.equals("movie")&&!type.equals("tv"))throw new IllegalArgumentException("作品类型无效。");
        String id=UUID.randomUUID().toString(),stamp=Json.now();JSONObject film=Json.copy(candidate);
        Json.put(film,"id",id);Json.put(film,"createdAt",stamp);Json.put(film,"updatedAt",stamp);
        Json.put(film,"metadataSource",external.isEmpty()?"manual":"tmdb");
        JSONObject entry=new JSONObject();Json.put(entry,"id",UUID.randomUUID().toString());Json.put(entry,"filmId",id);
        Json.put(entry,"watchStatus","want");Json.put(entry,"personalRating",null);Json.put(entry,"collectedAt",stamp);
        Json.put(entry,"createdAt",stamp);Json.put(entry,"updatedAt",stamp);Json.put(entry,"favoriteReason",null);Json.put(entry,"personalReview",null);
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
            ContentValues f=values(id,film);f.put("external_key",externalKey);db.insertOrThrow("films",null,f);
            ContentValues e=values(Json.text(entry,"id"),entry);e.put("film_id",id);db.insertOrThrow("entries",null,e);db.setTransactionSuccessful();
        }finally{db.endTransaction();}return get(id);
    }
    synchronized Item updateEntry(String id,JSONObject patch){
        Item item=get(id);for(String key:new String[]{"watchStatus","personalRating","favoriteReason","personalReview"})if(patch.has(key))Json.put(item.entry,key,patch.opt(key));
        String state=item.status();if(!state.equals("want")&&!state.equals("watching")&&!state.equals("watched")&&!state.equals("dropped"))throw new IllegalArgumentException("观影状态无效。");
        if(!item.entry.isNull("personalRating")){double rating=item.entry.optDouble("personalRating",-1);if(Double.isNaN(rating)||rating<0||rating>10)throw new IllegalArgumentException("评分范围是0到10。");}
        if(Json.text(item.entry,"personalReview").length()>5000||Json.text(item.entry,"favoriteReason").length()>2000)throw new IllegalArgumentException("文字过长。");
        if(state.equals("watched")&&Json.text(item.entry,"watchedAt").isEmpty())Json.put(item.entry,"watchedAt",Json.now());
        Json.put(item.entry,"updatedAt",Json.now());getWritableDatabase().update("entries",values(Json.text(item.entry,"id"),item.entry),"film_id=?",new String[]{id});return get(id);
    }
    synchronized Item refresh(String id,JSONObject candidate){
        Item old=get(id);JSONObject film=Json.copy(candidate);for(String key:new String[]{"id","createdAt"})Json.put(film,key,old.film.opt(key));
        JSONObject series=old.film.optJSONObject("series");if(series!=null&&series.optBoolean("customOrder"))Json.put(film,"series",series);
        for(String key:new String[]{"posterPath","backdropPath"})if(Json.text(film,key).isEmpty()&&!film.isNull(key))Json.put(film,key,old.film.opt(key));
        Json.put(film,"updatedAt",Json.now());getWritableDatabase().update("films",values(id,film),"id=?",new String[]{id});return get(id);
    }
    synchronized void editFilm(String id,JSONObject patch){
        Item item=get(id);String title=Json.text(patch,"title").trim();if(title.isEmpty())throw new IllegalArgumentException("片名不能为空。");
        for(String key:new String[]{"title","originalTitle","year","overview","series"})if(patch.has(key))Json.put(item.film,key,patch.opt(key));
        Json.put(item.film,"updatedAt",Json.now());getWritableDatabase().update("films",values(id,item.film),"id=?",new String[]{id});
    }
    synchronized void remove(String id){getWritableDatabase().delete("films","id=?",new String[]{id});}
    synchronized List<JSONObject> collections(){List<JSONObject> result=new ArrayList<>();try(Cursor c=getReadableDatabase().query("collections",new String[]{"json"},null,null,null,null,"rowid DESC")){while(c.moveToNext())result.add(Json.object(c.getString(0)));}return result;}
    synchronized void saveCollection(String id,String name,String description){
        name=name.trim();if(name.isEmpty()||name.length()>100)throw new IllegalArgumentException("专题名称须为1至100字。");
        JSONObject data=id.isEmpty()?new JSONObject():one("collections",id);if(data==null)throw new IllegalArgumentException("专题不存在。");
        boolean fresh=id.isEmpty();if(fresh)id=UUID.randomUUID().toString();Json.put(data,"id",id);Json.put(data,"name",name);Json.put(data,"description",description);
        ContentValues v=values(id,data);v.put("name",name);if(fresh)getWritableDatabase().insertOrThrow("collections",null,v);else getWritableDatabase().update("collections",v,"id=?",new String[]{id});
    }
    synchronized void removeCollection(String id){getWritableDatabase().delete("collections","id=?",new String[]{id});}
    synchronized Set<String> memberships(String id){Set<String> result=new HashSet<>();try(Cursor c=getReadableDatabase().rawQuery("SELECT collection_id FROM members WHERE film_id=?",new String[]{id})){while(c.moveToNext())result.add(c.getString(0));}return result;}
    synchronized void setMemberships(String id,Set<String> collections){SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{db.delete("members","film_id=?",new String[]{id});for(String collection:collections){ContentValues v=new ContentValues();v.put("collection_id",collection);v.put("film_id",id);db.insertOrThrow("members",null,v);}db.setTransactionSuccessful();}finally{db.endTransaction();}}
    synchronized List<JSONObject> resources(String id){List<JSONObject> result=new ArrayList<>();try(Cursor c=getReadableDatabase().rawQuery("SELECT json FROM resources WHERE film_id=?",new String[]{id})){while(c.moveToNext())result.add(Json.object(c.getString(0)));}return result;}
    synchronized void saveResource(String filmId,JSONObject data){
        get(filmId);String url=Json.text(data,"shareUrl");android.net.Uri uri=android.net.Uri.parse(url);
        if(!("https".equals(uri.getScheme())||"http".equals(uri.getScheme()))||uri.getHost()==null)throw new IllegalArgumentException("请输入有效的HTTP或HTTPS分享链接。");
        String id=Json.text(data,"id");boolean fresh=id.isEmpty();if(fresh)id=UUID.randomUUID().toString();Json.put(data,"id",id);Json.put(data,"filmId",filmId);Json.put(data,"provider","quark");
        ContentValues v=values(id,data);v.put("film_id",filmId);if(fresh)getWritableDatabase().insertOrThrow("resources",null,v);else getWritableDatabase().update("resources",v,"id=? AND film_id=?",new String[]{id,filmId});
    }
    synchronized void removeResource(String id){getWritableDatabase().delete("resources","id=?",new String[]{id});}
    synchronized JSONObject snapshot(){
        JSONObject result=new JSONObject();Json.put(result,"format","my-cinema-tv-backup");Json.put(result,"formatVersion",1);
        for(String table:new String[]{"films","entries","collections","resources"}){JSONArray rows=new JSONArray();try(Cursor c=getReadableDatabase().query(table,new String[]{"json"},null,null,null,null,null)){while(c.moveToNext())rows.put(Json.object(c.getString(0)));}Json.put(result,table,rows);}
        JSONArray members=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT collection_id,film_id FROM members",null)){while(c.moveToNext()){JSONObject item=new JSONObject();Json.put(item,"collectionId",c.getString(0));Json.put(item,"filmId",c.getString(1));members.put(item);}}Json.put(result,"members",members);return result;
    }
    synchronized void restore(JSONObject data){
        if(!Json.text(data,"format").equals("my-cinema-tv-backup")||data.optInt("formatVersion")!=1)throw new IllegalArgumentException("备份格式不兼容。");
        for(String table:new String[]{"films","entries","collections","resources","members"})if(data.optJSONArray(table)==null||data.optJSONArray(table).length()>10000)throw new IllegalArgumentException("备份内容无效或过大。");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
            for(String table:new String[]{"resources","members","entries","collections","films"})db.delete(table,null,null);
            for(String table:new String[]{"films","entries","collections","resources"})for(int i=0;i<Json.array(data,table).length();i++){
                JSONObject row=Json.array(data,table).optJSONObject(i);if(row==null||Json.text(row,"id").isEmpty())throw new IllegalArgumentException("备份缺少有效记录。");
                ContentValues v=values(Json.text(row,"id"),row);
                if(table.equals("films")){String external=Json.text(row,"externalId");v.put("external_key",external.isEmpty()?null:Json.text(row,"mediaType")+":"+external);if(Json.text(row,"title").trim().isEmpty())throw new IllegalArgumentException("备份片名无效。");}
                if(table.equals("entries")||table.equals("resources"))v.put("film_id",Json.text(row,"filmId"));
                if(table.equals("entries")){
                    String state=Json.text(row,"watchStatus");if(!state.equals("want")&&!state.equals("watching")&&!state.equals("watched")&&!state.equals("dropped"))throw new IllegalArgumentException("备份观影状态无效。");
                    if(!row.isNull("personalRating")){double rating=row.optDouble("personalRating",-1);if(Double.isNaN(rating)||rating<0||rating>10)throw new IllegalArgumentException("备份评分无效。");}
                }
                if(table.equals("collections"))v.put("name",Json.text(row,"name"));db.insertOrThrow(table,null,v);
            }
            JSONArray members=Json.array(data,"members");for(int i=0;i<members.length();i++){JSONObject m=members.optJSONObject(i);if(m==null)throw new IllegalArgumentException("专题关系无效。");ContentValues v=new ContentValues();v.put("collection_id",Json.text(m,"collectionId"));v.put("film_id",Json.text(m,"filmId"));db.insertOrThrow("members",null,v);}
            try(Cursor c=db.rawQuery("SELECT COUNT(*) FROM films f LEFT JOIN entries e ON e.film_id=f.id WHERE e.id IS NULL",null)){c.moveToFirst();if(c.getInt(0)>0)throw new IllegalArgumentException("备份缺少收藏记录。");}
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    private static final class LocaleCompat { static final java.util.Locale ROOT=java.util.Locale.ROOT; }
}
