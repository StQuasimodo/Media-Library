package io.mycinema.tv;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.*;

/** Independent timeline database joins backup transactions without changing either existing schema. */
final class CloudPlaybackProgress extends SQLiteOpenHelper {
    static final String DATABASE="cloud-playback.db";
    private final SharedPreferences legacy;
    CloudPlaybackProgress(Context context){super(context,DATABASE,null,1);legacy=context.getSharedPreferences("cloud-hls-progress-v1",Context.MODE_PRIVATE);getWritableDatabase();}
    @Override public void onCreate(SQLiteDatabase db){
        // SQLiteOpenHelper wraps creation/import/version in one transaction. Keep legacy XML intact.
        db.execSQL("CREATE TABLE progress(id TEXT PRIMARY KEY,position INTEGER NOT NULL CHECK(position>=0),duration INTEGER NOT NULL CHECK(duration>=0))");
        JSONArray rows=CloudProgressData.legacy(legacy.getAll());for(int i=0;i<rows.length();i++){
            JSONObject row=rows.optJSONObject(i);ContentValues values=new ContentValues();values.put("id",Json.text(row,"key"));values.put("position",row.optLong("position"));values.put("duration",row.optLong("duration"));db.insertOrThrow("progress",null,values);
        }
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){throw new IllegalStateException("云端播放进度版本不兼容，原数据保留。");}
    synchronized long position(String media,String selector){
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT position,duration FROM progress WHERE id=?",new String[]{CloudProgressData.key(media,selector)})){
            if(!cursor.moveToFirst())return 0;long position=cursor.getLong(0),duration=cursor.getLong(1);return duration>0&&duration-position<15000?0:position;
        }
    }
    synchronized void save(String media,String selector,long position,long duration){
        if(position<0||duration<0)return;ContentValues values=new ContentValues();values.put("id",CloudProgressData.key(media,selector));values.put("position",position);values.put("duration",duration);getWritableDatabase().replaceOrThrow("progress",null,values);
    }
}
