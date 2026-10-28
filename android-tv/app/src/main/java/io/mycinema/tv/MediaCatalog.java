package io.mycinema.tv;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Separate additive catalog: existing collection DB/schema and backups stay readable. */
final class MediaCatalog extends SQLiteOpenHelper {
    MediaCatalog(Context context){super(context,"media-sources.db",null,1);getWritableDatabase();}
    @Override public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE files(id TEXT PRIMARY KEY,json TEXT NOT NULL,film_id TEXT NOT NULL DEFAULT '')");db.execSQL("CREATE TABLE progress(id TEXT PRIMARY KEY,position INTEGER NOT NULL,duration INTEGER NOT NULL)");}
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){throw new IllegalStateException("媒体目录版本不兼容。");}
    synchronized JSONObject put(MediaSources.Entry file,String film){
        JSONObject old=get(file.key()),data=file.json();Json.put(data,"info",ResourceName.parse(file.name));
        ContentValues v=new ContentValues();v.put("id",file.key());v.put("json",data.toString());v.put("film_id",old==null||Json.text(old,"filmId").isEmpty()?film:Json.text(old,"filmId"));
        getWritableDatabase().insertWithOnConflict("files",null,v,SQLiteDatabase.CONFLICT_REPLACE);return get(file.key());
    }
    synchronized JSONObject get(String key){try(Cursor c=getReadableDatabase().rawQuery("SELECT json,film_id FROM files WHERE id=?",new String[]{key})){if(!c.moveToFirst())return null;JSONObject data=Json.object(c.getString(0));Json.put(data,"filmId",c.getString(1));return data;}}
    synchronized List<JSONObject> forFilm(String film){List<JSONObject> result=new ArrayList<>();try(Cursor c=getReadableDatabase().rawQuery("SELECT json FROM files WHERE film_id=?",new String[]{film})){while(c.moveToNext())result.add(Json.object(c.getString(0)));}java.util.Collections.sort(result,(a,b)->{JSONObject aa=a.optJSONObject("info"),bb=b.optJSONObject("info");int byEpisode=Integer.compare(aa==null?0:aa.optInt("episode"),bb==null?0:bb.optInt("episode"));return byEpisode!=0?byEpisode:Json.text(a,"name").compareToIgnoreCase(Json.text(b,"name"));});return result;}
    synchronized void associate(String key,String film){ContentValues values=new ContentValues();values.put("film_id",film);getWritableDatabase().update("files",values,"id=?",new String[]{key});}
    synchronized void forget(String source){getWritableDatabase().delete("files","id LIKE ?",new String[]{source+":%"});getWritableDatabase().delete("progress","id LIKE ?",new String[]{source+":%"});}
    synchronized long position(String key){try(Cursor c=getReadableDatabase().rawQuery("SELECT position,duration FROM progress WHERE id=?",new String[]{key})){if(!c.moveToFirst())return 0;long time=c.getLong(0),length=c.getLong(1);return length>0&&length-time<15000?0:time;}}
    synchronized void progress(String key,long time,long duration){if(time<0)return;ContentValues values=new ContentValues();values.put("id",key);values.put("position",time);values.put("duration",duration);getWritableDatabase().insertWithOnConflict("progress",null,values,SQLiteDatabase.CONFLICT_REPLACE);}
}
