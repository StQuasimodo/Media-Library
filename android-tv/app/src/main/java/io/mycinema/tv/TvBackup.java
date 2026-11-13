package io.mycinema.tv;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Environment;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONObject;

/** Portable data only. Login stores, mount credentials, images and stream leases are never copied. */
final class TvBackup {
    static final int MAX_BYTES=8*1024*1024;
    private static final String FORMAT="my-cinema-tv-backup",MEDIA="backup_media",CLOUD="backup_cloud";
    private final Context context;
    TvBackup(Context context){this.context=context.getApplicationContext();}
    private static void check() throws IOException {if(Thread.currentThread().isInterrupted())throw new IOException("Backup cancelled");}
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("备份内容无效或不完整，原数据未更改。");}
    private static String text(JSONObject row,String key,int maximum,boolean required){
        Object value=row.opt(key);if(value!=null&&value!=JSONObject.NULL&&!(value instanceof String))throw invalid();String result=Json.text(row,key);
        if(result.length()>maximum||required&&result.isEmpty()||result.indexOf('\0')>=0||result.indexOf('\r')>=0||result.indexOf('\n')>=0)throw invalid();return result;
    }
    private static long number(JSONObject row,String key){Object value=row.opt(key);if(!(value instanceof Integer)&&!(value instanceof Long))throw invalid();long result=((Number)value).longValue();if(result<0)throw invalid();return result;}
    private static String davUrl(String value){
        HttpUrl url=HttpUrl.parse(value);if(url==null||!url.scheme().equals("http")&&!url.scheme().equals("https")||!url.username().isEmpty()||!url.password().isEmpty()||url.query()!=null||url.fragment()!=null)throw invalid();return url.toString();
    }
    private static JSONObject file(JSONObject row){
        String source=text(row,"source",20,true),id=text(row,"fileId",8192,true),parent=text(row,"parent",8192,false),name=text(row,"name",16384,true);
        if(source.equals("quark")){if(id.length()>1024||id.contains("://")||parent.length()>1024||parent.contains("://"))throw invalid();}
        else if(source.equals("webdav")){id=davUrl(id);if(!parent.isEmpty())parent=davUrl(parent);}else throw invalid();
        String key=source+":"+id;if(row.has("key")&&!text(row,"key",9000,true).equals(key))throw invalid();
        JSONObject result=new JSONObject();Json.put(result,"source",source);Json.put(result,"fileId",id);Json.put(result,"key",key);Json.put(result,"parent",parent);Json.put(result,"name",name);Json.put(result,"size",number(row,"size"));
        Json.put(result,"filmId",text(row,"filmId",256,false));
        if(row.has("associationManual")){if(!(row.opt("associationManual") instanceof Boolean))throw invalid();Json.put(result,"associationManual",row.optBoolean("associationManual"));}
        // Regenerate derived facts; copy neither unknown fields nor old local/CDN routing hints.
        Json.put(result,"info",ResourceName.parse(name));return result;
    }
    private static JSONObject media(JSONObject value){
        if(value==null)throw invalid();JSONArray files=value.optJSONArray("files"),progress=value.optJSONArray("progress");
        if(files==null||progress==null||files.length()>10000||progress.length()>10000)throw invalid();
        JSONArray cleanFiles=new JSONArray(),cleanProgress=new JSONArray();Set<String> ids=new HashSet<>(),positions=new HashSet<>();
        for(int i=0;i<files.length();i++){JSONObject row=files.optJSONObject(i);if(row==null)throw invalid();JSONObject clean=file(row);String id=Json.text(clean,"key");if(!ids.add(id))throw invalid();cleanFiles.put(clean);}
        for(int i=0;i<progress.length();i++){
            JSONObject row=progress.optJSONObject(i);if(row==null)throw invalid();String id=text(row,"key",9000,true);if(!ids.contains(id)||!positions.add(id))throw invalid();long position=number(row,"position"),duration=number(row,"duration");
            JSONObject clean=new JSONObject();Json.put(clean,"key",id);Json.put(clean,"position",position);Json.put(clean,"duration",duration);cleanProgress.put(clean);
        }
        JSONObject result=new JSONObject();Json.put(result,"files",cleanFiles);Json.put(result,"progress",cleanProgress);return result;
    }
    static boolean includesMedia(JSONObject value){int version=value.optInt("formatVersion");return version==2||version==3;}
    static boolean includesCloudProgress(JSONObject value){return value.optInt("formatVersion")==3;}
    static void validate(JSONObject value){
        if(!Json.text(value,"format").equals(FORMAT))throw invalid();long version=number(value,"formatVersion");
        if(version!=1&&version!=2&&version!=3)throw new IllegalArgumentException("备份版本不兼容，请使用兼容版本的 My Cinema TV。");
        JSONObject collection=version==1?value:value.optJSONObject("collection");if(collection==null||!Json.text(collection,"format").equals(FORMAT)||number(collection,"formatVersion")!=1)throw invalid();
        for(String table:new String[]{"films","entries","collections","resources","members"})if(collection.optJSONArray(table)==null||collection.optJSONArray(table).length()>10000)throw invalid();
        if(version>=2)media(value.optJSONObject("media"));
        if(version==3)CloudProgressData.clean(value.optJSONArray("cloudProgress"));
    }
    private SQLiteDatabase attach(Library library) throws Exception {
        try(MediaCatalog ignored=new MediaCatalog(context);CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){/* Create unchanged media schema and import legacy cloud data before attaching. */}
        SQLiteDatabase db=library.getWritableDatabase();boolean media=false,cloud=false;
        try{
            db.execSQL("ATTACH DATABASE ? AS "+MEDIA,new Object[]{context.getDatabasePath("media-sources.db").getPath()});media=true;
            db.execSQL("ATTACH DATABASE ? AS "+CLOUD,new Object[]{context.getDatabasePath(CloudPlaybackProgress.DATABASE).getPath()});cloud=true;
            for(String schema:new String[]{"main",MEDIA,CLOUD})try(Cursor cursor=db.rawQuery("PRAGMA "+schema+".journal_mode",null)){
                if(!cursor.moveToFirst()||!java.util.Arrays.asList("delete","truncate","persist").contains(cursor.getString(0).toLowerCase(Locale.ROOT)))throw new IllegalStateException("当前数据库日志模式不支持联合备份恢复，操作已停止。");
            }
            return db;
        }catch(Exception failure){try{if(cloud)db.execSQL("DETACH DATABASE "+CLOUD);}finally{if(media)db.execSQL("DETACH DATABASE "+MEDIA);}throw failure;}
    }
    private static void detach(SQLiteDatabase db){try{db.execSQL("DETACH DATABASE "+CLOUD);}finally{db.execSQL("DETACH DATABASE "+MEDIA);}}
    private JSONObject snapshot(SQLiteDatabase db,Library library) throws Exception {
        JSONArray files=new JSONArray(),progress=new JSONArray();
        try(Cursor c=db.rawQuery("SELECT json,film_id FROM "+MEDIA+".files ORDER BY id",null)){while(c.moveToNext()){check();JSONObject row=Json.object(c.getString(0));Json.put(row,"filmId",c.getString(1));files.put(row);}}
        try(Cursor c=db.rawQuery("SELECT id,position,duration FROM "+MEDIA+".progress ORDER BY id",null)){while(c.moveToNext()){check();JSONObject row=new JSONObject();Json.put(row,"key",c.getString(0));Json.put(row,"position",c.getLong(1));Json.put(row,"duration",c.getLong(2));progress.put(row);}}
        JSONObject catalog=new JSONObject();Json.put(catalog,"files",files);Json.put(catalog,"progress",progress);
        JSONObject result=new JSONObject();Json.put(result,"format",FORMAT);Json.put(result,"formatVersion",3);Json.put(result,"createdAt",Json.now());Json.put(result,"collection",library.snapshot());Json.put(result,"media",media(catalog));
        JSONArray cloud=new JSONArray();try(Cursor cursor=db.rawQuery("SELECT id,position,duration FROM "+CLOUD+".progress ORDER BY id LIMIT "+(CloudProgressData.MAX_ROWS+1),null)){
            while(cursor.moveToNext()){check();cloud.put(CloudProgressData.row(cursor.getString(0),cursor.getLong(1),cursor.getLong(2)));}
        }
        Json.put(result,"cloudProgress",CloudProgressData.clean(cloud));return result;
    }
    JSONObject snapshot() throws Exception {
        check();try(Library library=new Library(context)){
            SQLiteDatabase db=attach(library);try{db.beginTransaction();try{JSONObject result=snapshot(db,library);db.setTransactionSuccessful();return result;}finally{db.endTransaction();}}finally{detach(db);}
        }
    }
    private static void restoreMedia(SQLiteDatabase db,JSONObject data) throws Exception {
        db.delete(MEDIA+".progress",null,null);db.delete(MEDIA+".files",null,null);
        JSONArray files=Json.array(data,"files");for(int i=0;i<files.length();i++){
            check();JSONObject row=Json.copy(files.getJSONObject(i));String id=Json.text(row,"key"),film=Json.text(row,"filmId");row.remove("filmId");ContentValues values=new ContentValues();values.put("id",id);values.put("json",row.toString());values.put("film_id",film);db.insertOrThrow(MEDIA+".files",null,values);
        }
        JSONArray progress=Json.array(data,"progress");for(int i=0;i<progress.length();i++){check();JSONObject row=progress.getJSONObject(i);ContentValues values=new ContentValues();values.put("id",Json.text(row,"key"));values.put("position",row.getLong("position"));values.put("duration",row.getLong("duration"));db.insertOrThrow(MEDIA+".progress",null,values);}
    }
    private static void restoreCloud(SQLiteDatabase db,JSONArray rows) throws Exception {
        db.delete(CLOUD+".progress",null,null);
        for(int i=0;i<rows.length();i++){check();JSONObject row=rows.getJSONObject(i);ContentValues values=new ContentValues();values.put("id",Json.text(row,"key"));values.put("position",row.getLong("position"));values.put("duration",row.getLong("duration"));db.insertOrThrow(CLOUD+".progress",null,values);}
    }
    void restore(JSONObject input) throws Exception {
        JSONObject data=Json.copy(input);validate(data);JSONObject clean=includesMedia(data)?media(data.getJSONObject("media")):null;JSONArray cloud=includesCloudProgress(data)?CloudProgressData.clean(data.getJSONArray("cloudProgress")):null;check();
        try(Library library=new Library(context)){
            SQLiteDatabase db=attach(library);
            try{db.beginTransaction();try{
                // All three files participate in the same rollback-journal transaction. Write the
                // recovery snapshot before changing any database; nested Library.restore joins it.
                writeLocal("before-restore.json",snapshot(db,library));check();
                library.restore(includesMedia(data)?data.getJSONObject("collection"):data);
                if(clean!=null)restoreMedia(db,clean);if(cloud!=null)restoreCloud(db,cloud);check();db.setTransactionSuccessful();
            }finally{db.endTransaction();}}finally{detach(db);}
        }
    }
    static byte[] encode(JSONObject value) throws Exception {
        validate(value);JSONObject portable=value;
        if(includesCloudProgress(value)){
            // Share unchanged metadata rather than duplicate the whole collection on a small TV heap.
            portable=new JSONObject();for(java.util.Iterator<String> keys=value.keys();keys.hasNext();){String key=keys.next();Json.put(portable,key,value.opt(key));}
            Json.put(portable,"cloudProgress",CloudProgressData.clean(value.optJSONArray("cloudProgress")));
        }
        byte[] bytes=portable.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>MAX_BYTES)throw new IllegalArgumentException("备份超过8MiB，当前电视无法处理此文件。");return bytes;
    }
    static JSONObject read(InputStream input) throws Exception {
        if(input==null)throw new FileNotFoundException("无法读取备份文件。");byte[] bytes;try{bytes=TmdbClient.read(input,MAX_BYTES);}catch(IllegalArgumentException oversized){throw new IllegalArgumentException("备份文件超过8MiB，无法读取。");}JSONObject data=Json.object(new String(bytes,StandardCharsets.UTF_8));validate(data);if(includesCloudProgress(data))Json.put(data,"cloudProgress",CloudProgressData.clean(data.optJSONArray("cloudProgress")));return data;
    }
    JSONObject readDocument(Uri uri) throws Exception {content(uri);try(InputStream input=context.getContentResolver().openInputStream(uri)){return read(input);}}
    void exportDocument(Uri uri) throws Exception {content(uri);byte[] bytes=encode(snapshot());try(OutputStream output=context.getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new FileNotFoundException("无法写入备份文件。");output.write(bytes);output.flush();}}
    private static void content(Uri uri){if(uri==null||!"content".equals(uri.getScheme()))throw new IllegalArgumentException("请选择系统文件服务中的备份文件。");}
    void writeLocal(String name,JSONObject value) throws Exception {write(new File(context.getFilesDir(),name),encode(value));}
    JSONObject readLocal(String name) throws Exception {try(InputStream input=new AtomicFile(new File(context.getFilesDir(),name)).openRead()){return read(input);}}
    JSONObject readFile(File file) throws Exception {try(InputStream input=new FileInputStream(file)){return read(input);}}
    private static void write(File target,byte[] bytes) throws Exception {
        AtomicFile file=new AtomicFile(target);FileOutputStream output=null;
        try{output=file.startWrite();output.write(bytes);file.finishWrite(output);}catch(Exception failure){if(output!=null)file.failWrite(output);throw failure;}
    }
    static String filename(){return "My-Cinema-TV-Backup-"+new SimpleDateFormat("yyyyMMdd-HHmmss",Locale.ROOT).format(new Date())+"-"+UUID.randomUUID().toString().substring(0,8)+".json";}
    private static File downloads(boolean writing){
        if(android.os.Build.VERSION.SDK_INT>22)throw new IllegalStateException("请使用系统文件选择器导出或恢复备份。");
        String state=Environment.getExternalStorageState();if(!Environment.MEDIA_MOUNTED.equals(state)&&(writing||!Environment.MEDIA_MOUNTED_READ_ONLY.equals(state)))throw new IllegalStateException("共享存储未就绪，请检查存储设备。");
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"MyCinema");
    }
    File exportDownloads() throws Exception {File directory=downloads(true);if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建下载备份目录。");File file=new File(directory,filename());write(file,encode(snapshot()));return file;}
    List<File> downloadBackups(){List<File> result=new ArrayList<>();File[] files=downloads(false).listFiles();if(files!=null)for(File file:files)if(file.isFile()&&file.getName().toLowerCase(Locale.ROOT).endsWith(".json")&&file.length()<=MAX_BYTES)result.add(file);java.util.Collections.sort(result,(a,b)->b.getName().compareTo(a.getName()));return result;}
}
