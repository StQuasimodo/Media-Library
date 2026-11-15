package io.mycinema.tv;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.GridView;
import android.widget.ListView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Disposable-emulator UI regression; restores the original database and preferences. */
final class FrontendScenario {
    private final Instrumentation test;
    private final Context context;
    private MainActivity activity;
    private final List<String> checks=new ArrayList<>();
    private final List<File> owned=new ArrayList<>();
    FrontendScenario(Instrumentation test){this.test=test;context=test.getTargetContext();}
    private void ui(Runnable action){test.runOnMainSync(action);}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);checks.add(label);}
    private void idle()throws Exception{test.waitForIdleSync();Thread.sleep(400);}
    private View view(int id){return activity.findViewById(id);}
    private TextView label(View root,String value){if(root instanceof TextView&&((TextView)root).getText().toString().equals(value))return (TextView)root;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){TextView found=label(((ViewGroup)root).getChildAt(n),value);if(found!=null)return found;}return null;}
    private int images(View root){int total=root instanceof android.widget.ImageView?1:0;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++)total+=images(((ViewGroup)root).getChildAt(n));return total;}
    private String asset(String name,String kind)throws Exception{
        String path=kind+"/manual/frontend-"+name+".img";File file=new File(context.getFilesDir(),"images/"+path);file.getParentFile().mkdirs();owned.add(file);
        try(InputStream input=test.getContext().getAssets().open("frontend-artwork/"+name);FileOutputStream out=new FileOutputStream(file)){byte[] buffer=new byte[8192];int length;while((length=input.read(buffer))!=-1)out.write(buffer,0,length);}return path;
    }
    private void nav(int id)throws Exception{ui(()->view(id).performClick());idle();}
    private void shot(String name)throws Exception{Bitmap image=test.getUiAutomation().takeScreenshot();if(image==null)throw new AssertionError("screenshot");try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"frontend-"+name+".png"))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
    List<String> run()throws Exception{
        JSONObject snapshot;try(Library library=new Library(context)){snapshot=library.snapshot();}
        SharedPreferences prefs=context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE);boolean folders=prefs.getBoolean("folderView",false),compact=prefs.getBoolean("compactWall",false);JSONObject report=new JSONObject();List<String> ids=new ArrayList<>();
        try{
            String[] keys={"inception","matrix","fight","interstellar"},titles={"盗梦空间","黑客帝国","搏击俱乐部","星际穿越"};int[] years={2010,1999,1999,2014};
            String backdrop=asset("backdrop.jpg","backdrop");
            try(Library library=new Library(context)){
                for(int n=0;n<keys.length;n++){JSONObject film=new JSONObject();Json.put(film,"title",titles[n]);Json.put(film,"year",years[n]);Json.put(film,"mediaType","movie");Json.put(film,"overview","界面验收使用的独立收藏，不是用户实际收藏。");Library.Item item=library.saveCandidate(film);ids.add(item.id());library.setArtwork(item.id(),"poster",asset(keys[n]+".jpg","poster"));library.setArtwork(item.id(),"backdrop",backdrop);}
                library.saveCollection("","夜色与霓虹 · 界面验收","在记忆、城市与光影之间，收藏愿意再次重看的作品。");
                java.util.Set<String> members=new java.util.HashSet<>();for(JSONObject collection:library.collections())if(Json.text(collection,"name").equals("夜色与霓虹 · 界面验收"))members.add(Json.text(collection,"id"));for(String id:ids)library.setMemberships(id,members);
            }
            prefs.edit().putBoolean("folderView",false).putBoolean("compactWall",false).commit();
            activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));idle();
            final boolean[] geometry={false};ui(()->{int[] rail=new int[2],title=new int[2];view(R.id.home_rail).getLocationOnScreen(rail);view(R.id.hero_title).getLocationOnScreen(title);geometry[0]=rail[1]<title[1];});check(geometry[0],"home poster rail precedes film information");shot("home");
            nav(R.id.nav_library);final int[] columns={0};ui(()->columns[0]=((GridView)view(R.id.library_grid)).getNumColumns());check(columns[0]>=3&&columns[0]<=6,"comfortable poster density uses larger covers");shot("library");
            nav(R.id.nav_collections);final boolean[] covers={false};ui(()->covers[0]=images(view(R.id.scene_body))>=4&&label(view(R.id.scene_body),"夜色与霓虹 · 界面验收") instanceof Button);check(covers[0],"collections expose cover mosaics and a named remote action");shot("collections");
            nav(R.id.nav_watchlist);final int[] before={0},index={-1};ui(()->{ListView list=(ListView)view(R.id.watchlist_list);before[0]=list.getAdapter().getCount();for(int n=0;n<before[0];n++)if(ids.contains(((Library.Item)list.getAdapter().getItem(n)).id())){index[0]=n;break;}if(index[0]>=0)list.setSelection(index[0]);});check(index[0]>=0,"watchlist renders actual wanted entries in a queue");idle();shot("watchlist");
            final String[] selected={""};ui(()->{ListView list=(ListView)view(R.id.watchlist_list);selected[0]=((Library.Item)list.getAdapter().getItem(index[0])).id();View action=RemoteUi.keyed(list,"watch:"+selected[0]+":watching");if(action==null)throw new AssertionError("visible queue action");action.requestFocus();action.performClick();});idle();
            try(Library library=new Library(context)){check(library.get(selected[0]).status().equals("watching"),"watch queue action commits to SQLite");}
            ui(()->geometry[0]=((ListView)view(R.id.watchlist_list)).getAdapter().getCount()==before[0]-1&&activity.getCurrentFocus()!=null&&String.valueOf(activity.getCurrentFocus().getTag(R.id.remote_focus_key)).startsWith("watch:"));check(geometry[0],"removing a wanted row retains useful remote focus");
            nav(R.id.nav_settings);ui(()->covers[0]=label(view(R.id.scene_body),"海报密度：舒适")!=null);check(covers[0],"poster density is configurable without text entry");shot("settings");
            ui(()->label(view(R.id.scene_body),"海报密度：舒适").performClick());nav(R.id.nav_library);ui(()->geometry[0]=((GridView)view(R.id.library_grid)).getNumColumns()>columns[0]);check(geometry[0],"compact density increases the actual grid column count");
            Json.put(report,"result","passed");return checks;
        }catch(Exception|AssertionError error){Json.put(report,"result","failed");Json.put(report,"error",error.toString());throw error;}
        finally{
            if(activity!=null){ui(activity::finish);test.waitForIdleSync();}
            try(Library library=new Library(context)){library.restore(snapshot);}prefs.edit().putBoolean("folderView",folders).putBoolean("compactWall",compact).commit();for(File file:owned)file.delete();
            Json.put(report,"checks",new JSONArray(checks));Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);Json.put(report,"physicalTelevisionVerified",false);
            try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"frontend-report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
        }
    }
}
