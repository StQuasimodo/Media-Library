package io.mycinema.tv;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import okhttp3.HttpUrl;

/** Persists only the chosen folder. Local URL/password are regenerated when the server starts. */
final class QuarkDavManager {
    private final Context context;private final SharedPreferences prefs;
    private PlaybackRelay server;private QuarkDavTree tree;
    QuarkDavManager(Context context){this.context=context.getApplicationContext();prefs=context.getSharedPreferences("quark-dav",Context.MODE_PRIVATE);}
    boolean enabled(){return prefs.getBoolean("enabled",false);}
    String rootId(){return prefs.getString("folderId","0");}
    String name(){return prefs.getString("folderName","夸克影视");}
    synchronized boolean running(){return server!=null;}
    void enable(String id,String name) throws Exception {
        if(id.isEmpty()||id.length()>1024||name.isEmpty()||name.length()>1024)throw new IllegalArgumentException("请选择有效的夸克文件夹。");
        new MediaSources(context).rawQuarkList(id); // Validate first; a failed selection keeps the prior mount.
        MediaSources.interrupted();
        synchronized(this){if(!prefs.edit().putString("folderId",id).putString("folderName",name).putBoolean("enabled",true).commit())throw new IllegalStateException("无法保存夸克WebDAV文件夹。");stop();ensure();}
    }
    synchronized void disable(){stop();prefs.edit().clear().apply();}
    synchronized void stop(){if(server!=null)server.close();server=null;tree=null;}
    private synchronized PlaybackRelay ensure() throws Exception {
        if(!enabled())throw new IllegalStateException("请先选择夸克文件夹并启用WebDAV。");
        if(server==null){MediaSources backend=new MediaSources(context);if(!backend.connected("quark"))throw new IllegalStateException("请先连接夸克账号。");tree=new QuarkDavTree(rootId(),name(),backend::rawQuarkList);server=new PlaybackRelay(backend,tree);}
        return server;
    }
    synchronized MediaSources.Lease endpoint() throws Exception {PlaybackRelay active=ensure();Map<String,String> headers=new LinkedHashMap<>();headers.put("Authorization",active.authorization());return new MediaSources.Lease(HttpUrl.parse(active.url()),headers);}
    synchronized String connectionInfo() throws Exception {PlaybackRelay active=ensure();return "地址："+active.url()+"\n用户名："+active.username()+"\n密码："+active.password()+"\n\n仅限电视本机；My Cinema退到后台后停止。重新启动时地址和密码可能变化。";}
    List<MediaSources.Entry> list(String id) throws Exception {
        PlaybackRelay active;QuarkDavTree mounted;synchronized(this){active=ensure();mounted=tree;}
        String path=mounted.locate(id);JSONObject config=new JSONObject();Json.put(config,"url",active.url());Json.put(config,"user",active.username());Json.put(config,"password",active.password());
        List<MediaSources.Entry> rows=new MediaSources(context).listDav(config,active.url()+path),result=new ArrayList<>();
        HttpUrl base=HttpUrl.parse(active.url());
        for(MediaSources.Entry row:rows){String relative=HttpUrl.parse(row.id).encodedPath().substring(base.encodedPath().length());QuarkDavTree.Node node=mounted.resolve(relative);
            result.add(new MediaSources.Entry("quark",node.entry.id,row.name,node.entry.parent,row.directory,row.size,relative,mounted.rootId));}
        return result;
    }
    MediaSources.Lease playback(JSONObject file) throws Exception {
        PlaybackRelay active;QuarkDavTree mounted;synchronized(this){active=ensure();mounted=tree;}
        String id=Json.text(file,"fileId"),relative=Json.text(file,"davPath");
        if(!Json.text(file,"davRoot").equals(mounted.rootId)||relative.isEmpty())relative=mounted.locate(id);
        QuarkDavTree.Node node=mounted.resolve(relative);if(node.entry.directory||!node.entry.id.equals(id))throw new IllegalStateException("该资源不在已选择的夸克WebDAV文件夹中。");
        Map<String,String> headers=new LinkedHashMap<>();headers.put("Authorization",active.authorization());return new MediaSources.Lease(HttpUrl.parse(active.url()+relative),headers);
    }
}
