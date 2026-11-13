package io.mycinema.tv;

import android.animation.ValueAnimator;
import android.app.Instrumentation;
import android.content.*;
import android.graphics.*;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Disposable API22 emulator only. Real native navigation, focus, scroll and bitmap rendering. */
final class MotionScenario {
    private final Instrumentation test;private final Context context;private MainActivity activity;
    private final List<String> checks=new ArrayList<>();
    MotionScenario(Instrumentation test){this.test=test;context=test.getTargetContext();}
    private void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks.add(name);}
    private void ui(Runnable action){test.runOnMainSync(action);}
    private View view(int id){return activity.findViewById(id);}
    private View label(View v,String text){if(v instanceof TextView&&((TextView)v).getText().toString().equals(text))return v;if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++){View found=label(((ViewGroup)v).getChildAt(n),text);if(found!=null)return found;}return null;}
    private String text(View v){StringBuilder s=new StringBuilder();if(v instanceof TextView)s.append(((TextView)v).getText());if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++)s.append(text(((ViewGroup)v).getChildAt(n)));return s.toString();}
    private float[] state(){final float[][] result={null};ui(()->result[0]=new float[]{view(R.id.scene_body).getAlpha(),view(R.id.nav_cursor).getTranslationX(),view(R.id.cinema_blurred_backdrop).getAlpha(),view(R.id.cinema_backdrop_dim).getAlpha(),view(R.id.cinema_backdrop).getTranslationY()});return result[0];}
    private void scale(float value)throws Exception{try(ParcelFileDescriptor fd=test.getUiAutomation().executeShellCommand("settings put global animator_duration_scale "+value);InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(fd)){while(input.read()!=-1){}}java.lang.reflect.Method setter=ValueAnimator.class.getDeclaredMethod("setDurationScale",float.class);setter.setAccessible(true);setter.invoke(null,value);}
    private void shot(String name)throws Exception{Bitmap image=test.getUiAutomation().takeScreenshot();try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),name+".png"))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
    private static int files(File directory){File[] list=directory.listFiles();int count=0;if(list!=null)for(File file:list)count+=file.isDirectory()?files(file):1;return count;}
    List<String> run()throws Exception{
        float original=Settings.Global.getFloat(context.getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1);
        SharedPreferences prefs=context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE);boolean folderView=prefs.getBoolean("folderView",false);
        JSONObject snapshot;try(Library library=new Library(context)){snapshot=library.snapshot();}
        File fixture=new File(context.getFilesDir(),"images/backdrop/manual/motion-fixture.png.img");JSONObject report=new JSONObject();
        try{
            JSONArray cases;try(InputStream input=test.getContext().getAssets().open("folder-title-cases.json")){cases=new JSONArray(new String(TmdbClient.read(input,65536),StandardCharsets.UTF_8));}
            for(int n=0;n<cases.length();n++){JSONObject row=cases.getJSONObject(n);check(FolderTitle.label(row.getString("input")).equals(row.getString("expected")),"shared folder title: "+row.getString("input"));}
            Bitmap stripes=Bitmap.createBitmap(160,90,Bitmap.Config.RGB_565);for(int x=0;x<160;x++)for(int y=0;y<90;y++)stripes.setPixel(x,y,x%2==0?Color.WHITE:Color.BLACK);
            Bitmap blurred=Artwork.softened(stripes);int red=Color.red(blurred.getPixel(80,45));check(red>80&&red<180&&Color.red(stripes.getPixel(80,45))>240,"actual two-pass blur changes pixels without changing source");blurred.recycle();stripes.recycle();
            fixture.getParentFile().mkdirs();Bitmap art=Bitmap.createBitmap(960,540,Bitmap.Config.RGB_565);Canvas canvas=new Canvas(art);Paint paint=new Paint();paint.setShader(new LinearGradient(0,0,960,540,0xff224b76,0xff9e7646,Shader.TileMode.CLAMP));canvas.drawPaint(paint);try(FileOutputStream out=new FileOutputStream(fixture)){art.compress(Bitmap.CompressFormat.PNG,100,out);}art.recycle();int imageCount=files(new File(context.getFilesDir(),"images"));
            String id;try(Library library=new Library(context)){JSONObject candidate=new JSONObject();Json.put(candidate,"title","动效验收");Json.put(candidate,"mediaType","tv");Json.put(candidate,"overview","这是一份独立的遥控器与滚动验收资料。\n\n保留收藏、播放和媒体源的原始数据。");Json.put(candidate,"series",TmdbClient.series("manual:motion","动效验收（系列）",1));Library.Item item=library.saveCandidate(candidate);id=item.id();library.setArtwork(id,"backdrop","backdrop/manual/motion-fixture.png.img");}
            prefs.edit().putBoolean("folderView",false).commit();scale(1);
            activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));test.waitForIdleSync();Thread.sleep(450);
            float start=state()[1];ui(()->view(R.id.nav_library).performClick());boolean pageMiddle=false,navMiddle=false;float target=RemoteUi.dp(context,236);
            for(int n=0;n<45;n++){float[] s=state();pageMiddle|=s[0]>0&&s[0]<.99f;navMiddle|=s[1]>start+.5f&&s[1]<target-.5f;if(pageMiddle&&navMiddle)break;Thread.sleep(8);}
            check(pageMiddle,"native scene entry has intermediate opacity");check(navMiddle,"persistent navigation pill moves through intermediate positions");Thread.sleep(400);check(Math.abs(state()[1]-target)<1&&state()[0]>.99f,"navigation and page settle on selected library");
            ui(()->{view(R.id.nav_collections).performClick();view(R.id.nav_watchlist).performClick();});Thread.sleep(450);check(Math.abs(state()[1]-RemoteUi.dp(context,388))<1,"rapid navigation settles on newest destination");
            ui(()->view(R.id.nav_library).performClick());test.waitForIdleSync();Thread.sleep(400);
            final String filmId=id;final int[] index={-1};ui(()->{GridView grid=(GridView)view(R.id.library_grid);for(int n=0;n<grid.getAdapter().getCount();n++)if(((Library.Item)grid.getAdapter().getItem(n)).id().equals(filmId))index[0]=n;if(index[0]>=0)grid.performItemClick(grid.getChildAt(Math.max(0,index[0]-grid.getFirstVisiblePosition())),index[0],index[0]);});check(index[0]>=0,"fixture opened through native library grid");test.waitForIdleSync();Thread.sleep(500);
            final boolean[] ready={false};for(int n=0;n<50;n++){ui(()->ready[0]=((ImageView)view(R.id.cinema_blurred_backdrop)).getDrawable()!=null);if(ready[0])break;Thread.sleep(40);}check(ready[0],"sharp and blurred backgrounds decode on API22");
            final boolean[] geometry={false};ui(()->{CinemaScrollView scroll=(CinemaScrollView)view(R.id.detail_scroll);int[] title={0,0},body={0,0};view(R.id.detail_title).getLocationOnScreen(title);view(R.id.scene_body).getLocationOnScreen(body);geometry[0]=scroll.getScrollY()==0&&view(R.id.detail_hero).getHeight()>=view(R.id.scene_body).getHeight()*.9f&&title[1]>body[1]+view(R.id.scene_body).getHeight()*.45f;});check(geometry[0],"detail initial focus preserves large unobscured hero");
            final boolean[] hints={false};ui(()->hints[0]=!text(view(R.id.scene_body)).contains("季份未标注")&&!text(view(R.id.scene_body)).contains("按季分配"));check(hints[0],"detail contains no technical artwork provenance");shot("motion-detail-top");
            ui(()->((CinemaScrollView)view(R.id.detail_scroll)).smoothScrollTo(0,Math.round(view(R.id.detail_hero).getHeight()*.72f)));Thread.sleep(650);float[] s=state();check(s[2]>.8f&&s[3]>.5f&&s[4]<-1,"scroll progressively blends blur, dimming and artwork movement");shot("motion-detail-scroll");
            ui(()->{((CinemaScrollView)view(R.id.detail_scroll)).scrollTo(0,0);label(view(R.id.scene_body),"查看资源").performClick();});test.waitForIdleSync();Thread.sleep(450);ui(()->geometry[0]=view(R.id.resources_section).hasFocus()&&((CinemaScrollView)view(R.id.detail_scroll)).getScrollY()>0);check(geometry[0],"remote primary action focuses and scrolls to resources");
            check(files(new File(context.getFilesDir(),"images"))==imageCount,"blur derivative adds no disk cache");
            prefs.edit().putBoolean("folderView",true).commit();ui(()->view(R.id.nav_library).performClick());test.waitForIdleSync();Thread.sleep(400);ui(()->hints[0]=label(view(R.id.scene_body),"动效验收")!=null&&label(view(R.id.scene_body),"动效验收（系列）")==null);check(hints[0],"native folder card omits parenthetical suffix");try(Library library=new Library(context)){check(library.get(id).seriesTitle().equals("动效验收（系列）")&&library.get(id).seriesKey().equals("manual:motion"),"folder display preserves stored title and identity");}
            scale(0);ui(()->view(R.id.nav_collections).performClick());float[] reduced=state();check(reduced[0]==1&&Math.abs(reduced[1]-RemoteUi.dp(context,312))<1,"system reduced motion immediately settles page and navigation");
            Json.put(report,"result","passed");return checks;
        }catch(Exception|AssertionError error){Json.put(report,"result","failed");Json.put(report,"error",error.toString());throw error;}
        finally{
            if(activity!=null){ui(activity::finish);test.waitForIdleSync();}try(Library library=new Library(context)){library.restore(snapshot);}prefs.edit().putBoolean("folderView",folderView).commit();fixture.delete();scale(original);
            Json.put(report,"checks",new JSONArray(checks));Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);Json.put(report,"physicalTelevisionVerified",false);try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"motion-report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
        }
    }
}
