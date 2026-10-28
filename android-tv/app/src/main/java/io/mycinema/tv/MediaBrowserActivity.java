package io.mycinema.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Native folder browser for both sources; does not require a separate gateway for Quark. */
public final class MediaBrowserActivity extends Activity {
    private MediaSources sources;private MediaCatalog catalog;private Library library;
    private LinearLayout content,root;private ScrollView scroll;private TextView status;private String source="",parent="",folder="";private int generation;
    private final ArrayDeque<String[]> history=new ArrayDeque<>();private final ExecutorService jobs=Executors.newSingleThreadExecutor();private Future<?> task;private boolean working,disposed;
    interface Work<T>{T run() throws Exception;}interface Done<T>{void run(T value);}
    @Override public void onCreate(Bundle state){super.onCreate(state);sources=new MediaSources(this);catalog=new MediaCatalog(this);library=new Library(this);if(state!=null){source=state.getString("source","");parent=state.getString("parent","");folder=state.getString("folder","");}render();}
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);out.putString("source",source);out.putString("parent",parent);out.putString("folder",folder);}
    private void base(String title){generation++;root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(32,12,32,16);root.setBackgroundColor(MainActivity.SPACE);status=text(title,22);root.addView(status);scroll=new ScrollView(this);content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);}
    private TextView text(String value,int size){TextView view=new TextView(this);view.setText(value);view.setTextColor(MainActivity.PRIMARY);view.setTextSize(size);view.setPadding(8,8,8,8);return view;}
    private Button button(String value,Runnable action){Button button=new Button(this);button.setText(value);button.setTextSize(15);button.setAllCaps(false);button.setTextColor(MainActivity.PRIMARY);StateListDrawable states=new StateListDrawable();GradientDrawable focused=new GradientDrawable();focused.setColor(0xff282f3b);focused.setStroke(2,MainActivity.ACCENT);states.addState(new int[]{android.R.attr.state_focused},focused);GradientDrawable normal=new GradientDrawable();normal.setColor(MainActivity.CONTENT);states.addState(new int[]{},normal);button.setBackground(states);button.setPadding(12,8,12,8);button.setOnClickListener(v->{if(!working)action.run();});content.addView(button,new LinearLayout.LayoutParams(-1,-2));return button;}
    private void render(){
        base(source.isEmpty()?"媒体源":(source.equals("quark")?"夸克网盘":"WebDAV")+" · "+folder);
        if(source.isEmpty()){
            content.addView(text("电视独立读取目录并内置播放。扫描只关联已有收藏；未匹配的文件可手动关联，不会自动添加错误作品。",15));
            button(sources.connected("quark")?"夸克网盘 · 浏览文件夹":"连接夸克账号",()->{if(sources.connected("quark"))open("quark");else startActivityForResult(new Intent(this,QuarkLoginActivity.class),1);});
            if(sources.connected("quark"))button("重新登录夸克",()->startActivityForResult(new Intent(this,QuarkLoginActivity.class),1));
            button(sources.connected("webdav")?"WebDAV · 浏览文件夹":"添加WebDAV",()->{if(sources.connected("webdav"))open("webdav");else configureDav();});
            if(sources.connected("webdav"))button("重新配置WebDAV",this::configureDav);
            for(String provider:new String[]{"quark","webdav"})if(sources.connected(provider))button("断开"+(provider.equals("quark")?"夸克":"WebDAV"),()->new AlertDialog.Builder(this).setTitle("断开媒体源？").setMessage("清除该媒体源的凭据、文件关联和播放进度。影视收藏保留。").setNegativeButton("取消",null).setPositiveButton("断开",(d,n)->{sources.disconnect(provider);catalog.forget(provider);getPreferences(0).edit().remove(provider+"Folder").remove(provider+"Name").apply();if(provider.equals("quark"))android.webkit.CookieManager.getInstance().removeAllCookies(null);render();}).show());
            content.addView(text("内置播放使用VideoLAN LibVLC 3.7.7（LGPL-2.1）。",13));button("开源许可与源码",()->new AlertDialog.Builder(this).setTitle("VideoLAN LibVLC / OkHttp").setMessage("LibVLC 3.7.7 · LGPL-2.1\nhttps://code.videolan.org/videolan/vlc\nhttps://code.videolan.org/videolan/vlc-android\n\nOkHttp 3.12.13 / Okio · Apache-2.0\nhttps://github.com/square/okhttp\n\n许可与完整源码说明见 My Cinema 的 GitHub 项目文档。").setPositiveButton("关闭",null).show());button("返回收藏",this::finish);return;
        }
        button("返回媒体源",()->{source="";history.clear();render();});
        button("扫描此文件夹并匹配收藏",this::scan);
        button("记住此文件夹",()->{getPreferences(0).edit().putString(source+"Folder",parent).putString(source+"Name",folder).apply();status.setText("已记住文件夹；下次浏览将从这里开始。");});
        button("回到网盘根目录",()->{history.clear();job("读取根目录…",()->sources.root(source),root->{parent=root;folder="根目录";render();});});
        scroll.setLayoutParams(new LinearLayout.LayoutParams(-1,-2));
        android.widget.ListView list=new android.widget.ListView(this);root.addView(list,new LinearLayout.LayoutParams(-1,0,1));
        job("读取目录…",()->{
            List<MediaSources.Entry> rows=sources.list(source,parent),visible=new ArrayList<>();List<Library.Item> films=library.list("","","","","recent");
            for(MediaSources.Entry row:rows)if(row.directory||row.video()){MediaSources.interrupted();visible.add(row);if(row.video())catalog.put(row,ResourceName.match(row.name,folder,films));}return visible;
        },rows->{String[] labels=new String[rows.size()];for(int i=0;i<rows.size();i++){MediaSources.Entry row=rows.get(i);labels[i]=(row.directory?"文件夹   ":"")+row.name;}
            list.setAdapter(new android.widget.ArrayAdapter<>(this,android.R.layout.simple_list_item_1,labels));
            list.setOnItemClickListener((adapter,view,index,id)->{if(working)return;MediaSources.Entry row=rows.get(index);if(row.directory){history.push(new String[]{parent,folder});parent=row.id;folder=row.name;render();}else fileActions(row);});
            if(rows.isEmpty())content.addView(text("此文件夹没有视频文件或子文件夹。",16));status.setText(folder+" · "+rows.size()+" 项");list.requestFocus();});
    }
    private void open(String provider){source=provider;job("打开媒体源…",()->sources.root(provider),root->{parent=getPreferences(0).getString(provider+"Folder",root);folder=getPreferences(0).getString(provider+"Name","根目录");history.clear();render();});}
    private <T> void job(String label,Work<T> work,Done<T> done){if(working)return;working=true;status.setText(label);int owner=generation;task=jobs.submit(()->{T answer=null;Exception failure=null;try{answer=work.run();}catch(Exception error){failure=error;}final T value=answer;final Exception error=failure;runOnUiThread(()->{if(disposed)return;working=false;if(owner!=generation)return;if(error!=null){status.setText(error instanceof IllegalArgumentException||error instanceof IllegalStateException?error.getMessage():"操作失败，请检查网络后重试。");return;}done.run(value);});});}
    private EditText field(LinearLayout form,String label,boolean password){form.addView(text(label,14));EditText input=new EditText(this);input.setTextColor(MainActivity.PRIMARY);input.setSingleLine(true);if(password)input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);form.addView(input);return input;}
    private void configureDav(){LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(24,0,24,0);EditText url=field(form,"WebDAV目录地址（例如 https://服务地址/dav/）",false),user=field(form,"用户名（匿名可留空）",false),password=field(form,"密码",true);form.addView(text("HTTPS会验证系统证书。HTTP只适合可信局域网，账号和视频将以明文传输。这里只连接已有WebDAV服务，不会把夸克网址自动转换为WebDAV。",14));ScrollView scroll=new ScrollView(this);scroll.addView(form);AlertDialog dialog=new AlertDialog.Builder(this).setTitle("连接WebDAV").setView(scroll).setNegativeButton("取消",null).setPositiveButton("验证并保存",null).create();dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{String address=url.getText().toString(),username=user.getText().toString(),secret=password.getText().toString();Runnable save=()->{dialog.dismiss();job("验证WebDAV目录…",()->{sources.saveDav(address,username,secret);return true;},done->{source="";render();});};try{if(!MediaSources.davUrl(address).isHttps())new AlertDialog.Builder(this).setTitle("连接HTTP服务？").setMessage("此连接不加密，用户名、密码和视频可能被同一网络中的其他设备读取。建议使用HTTPS。").setNegativeButton("取消",null).setPositiveButton("连接",(confirm,n)->save.run()).show();else save.run();}catch(IllegalArgumentException error){url.setError(error.getMessage());}}));dialog.show();}
    private void fileActions(MediaSources.Entry row){JSONObject data=catalog.get(row.key());String film=Json.text(data,"filmId");new AlertDialog.Builder(this).setTitle(row.name).setItems(new String[]{"播放 / 续播",film.isEmpty()?"关联到收藏":"更改作品关联","取消作品关联"},(dialog,n)->{if(n==0)startActivity(new Intent(this,PlayerActivity.class).putExtra("mediaKey",row.key()));if(n==1)associate(row.key());if(n==2){catalog.associate(row.key(),"");status.setText("已取消关联，网盘文件保留。");}}).setNegativeButton("返回",null).show();}
    private void associate(String key){List<Library.Item> films=library.list("","","","","title_asc");if(films.isEmpty()){status.setText("请先在影视库添加作品，再关联文件。");return;}String[] labels=new String[films.size()];for(int i=0;i<labels.length;i++)labels[i]=films.get(i).title();new AlertDialog.Builder(this).setTitle("选择收藏作品").setItems(labels,(dialog,n)->{catalog.associate(key,films.get(n).id());status.setText("已关联到《"+films.get(n).title()+"》。");}).setNegativeButton("返回",null).show();}
    private void scan(){final String selectedSource=source,selectedParent=parent,selectedName=folder;job("扫描目录并匹配收藏…",()->{
        List<Library.Item> films=library.list("","","","","recent");List<MediaSources.Entry> videos=new ArrayList<>();List<String> matches=new ArrayList<>();ArrayDeque<String[]> queue=new ArrayDeque<>();queue.add(new String[]{selectedParent,selectedName,"0"});Set<String> seen=new HashSet<>();
        while(!queue.isEmpty()){MediaSources.interrupted();String[] current=queue.remove();if(!seen.add(current[0]))continue;int depth=Integer.parseInt(current[2]);if(seen.size()>200||depth>16)throw new IllegalStateException("目录过大或层级过深，请选择更小的影视文件夹。本次扫描未写入。");
            for(MediaSources.Entry row:sources.list(selectedSource,current[0])){MediaSources.interrupted();if(row.directory){JSONObject parsed=ResourceName.parse(row.name);String context=Json.text(parsed,"title").isEmpty()?current[1]+" "+row.name:row.name;queue.add(new String[]{row.id,context,String.valueOf(depth+1)});}else if(row.video()){videos.add(row);matches.add(ResourceName.match(row.name,current[1],films));if(videos.size()>5000)throw new IllegalStateException("视频超过5000项，请选择更小目录。本次扫描未写入。");}}
        }
        MediaSources.interrupted();int linked=0;android.database.sqlite.SQLiteDatabase db=catalog.getWritableDatabase();db.beginTransaction();try{for(int i=0;i<videos.size();i++){MediaSources.interrupted();JSONObject saved=catalog.put(videos.get(i),matches.get(i));if(!Json.text(saved,"filmId").isEmpty())linked++;}db.setTransactionSuccessful();}finally{db.endTransaction();}return new int[]{videos.size(),linked};
    },counts->status.setText("扫描完成："+counts[0]+" 个视频，"+counts[1]+" 个已关联。未匹配项可浏览文件后手动关联；未移除旧记录。"));}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);source="";render();}
    @Override public void onBackPressed(){if(working){status.setText("正在操作，请稍候；返回收藏可在操作结束后进行。");return;}if(!history.isEmpty()){String[] previous=history.pop();parent=previous[0];folder=previous[1];render();}else if(!source.isEmpty()){source="";render();}else finish();}
    @Override protected void onDestroy(){disposed=true;if(task!=null)task.cancel(true);jobs.shutdownNow();/* Workers own DB handles until their bounded request completes. */jobsShutdown();super.onDestroy();}
    private void jobsShutdown(){new Thread(()->{try{jobs.awaitTermination(35,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}if(jobs.isTerminated()){catalog.close();library.close();}},"cinema-media-cleanup").start();}
}
