package io.mycinema.tv;

import android.net.Uri;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;

/** A read-only mount anchored at one Quark folder. Every path is checked against its ancestry. */
final class QuarkDavTree {
    interface Listing { List<MediaSources.Entry> list(String folder) throws Exception; }
    static final class Missing extends Exception { private static final long serialVersionUID=1L; }
    static final class Node {
        final MediaSources.Entry entry;final String path;
        Node(MediaSources.Entry entry,String path){this.entry=entry;this.path=path;}
    }
    private static final class Cached {
        final List<MediaSources.Entry> entries;final long at;
        Cached(List<MediaSources.Entry> entries){this.entries=entries;at=android.os.SystemClock.elapsedRealtime();}
    }
    final String rootId,name;private final Listing listing;
    private final LinkedHashMap<String,Cached> cache=new LinkedHashMap<>(8,0.75f,true);
    private final LinkedHashMap<String,String> paths=new LinkedHashMap<>(128,0.75f,true);
    QuarkDavTree(String rootId,String name,Listing listing){this.rootId=rootId;this.name=name;this.listing=listing;paths.put(rootId,"");}
    static String segment(MediaSources.Entry item){return Base64.encodeToString(item.id.getBytes(StandardCharsets.UTF_8),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING)+"~"+Uri.encode(item.name);}
    private static String fid(String segment) throws Missing {
        int split=segment.indexOf('~');if(split<1)throw new Missing();String id=segment.substring(0,split);
        if(!id.matches("[A-Za-z0-9_-]{1,1400}"))throw new Missing();
        try{String decoded=new String(Base64.decode(id,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8);
            if(!Base64.encodeToString(decoded.getBytes(StandardCharsets.UTF_8),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING).equals(id))throw new Missing();return decoded;
        }catch(IllegalArgumentException error){throw new Missing();}
    }
    List<MediaSources.Entry> children(String id) throws Exception {
        synchronized(cache){Cached found=cache.get(id);if(found!=null&&android.os.SystemClock.elapsedRealtime()-found.at<5000)return found.entries;}
        MediaSources.interrupted();List<MediaSources.Entry> rows=listing.list(id);Set<String> ids=new HashSet<>();
        for(MediaSources.Entry entry:rows)if(!entry.parent.equals(id)||entry.id.equals(id)||!ids.add(entry.id))throw new IllegalStateException("夸克目录层级异常，请稍后重试。");
        synchronized(cache){cache.put(id,new Cached(rows));int count=0;for(Cached value:cache.values())count+=value.entries.size();while(cache.size()>8||count>12000){String first=cache.keySet().iterator().next();count-=cache.remove(first).entries.size();}}
        return rows;
    }
    Node root(){return new Node(new MediaSources.Entry("quark",rootId,name,"",true,0),"");}
    Node resolve(String relative) throws Exception {
        if(relative.length()>7000||relative.startsWith("/")||relative.contains("?")||relative.contains("#")||relative.contains("\\"))throw new Missing();
        Node current=root();if(relative.isEmpty())return current;
        String[] parts=relative.split("/",-1);if(parts.length>18)throw new Missing();
        for(int n=0;n<parts.length;n++){
            String part=parts[n];if(part.isEmpty()){if(n==parts.length-1&&current.entry.directory)return current;throw new Missing();}
            if(!current.entry.directory)throw new Missing();String id=fid(part);MediaSources.Entry selected=null;
            for(MediaSources.Entry entry:children(current.entry.id))if(entry.id.equals(id)){selected=entry;break;}
            if(selected==null)throw new Missing();String path=current.path+part+(selected.directory?"/":"");current=new Node(selected,path);remember(selected.id,path);
        }
        if(current.entry.directory)throw new Missing();return current;
    }
    List<Node> childNodes(Node folder) throws Exception {
        List<Node> result=new ArrayList<>();if(!folder.entry.directory)return result;
        for(MediaSources.Entry entry:children(folder.entry.id)){String path=folder.path+segment(entry)+(entry.directory?"/":"");remember(entry.id,path);result.add(new Node(entry,path));}return result;
    }
    private void remember(String id,String path){synchronized(paths){paths.put(id,path);while(paths.size()>6000)paths.remove(paths.keySet().iterator().next());}}
    String knownPath(String id){if(id.equals(rootId))return "";synchronized(paths){return paths.get(id);}}
    String locate(String id) throws Exception {
        String found=knownPath(id);if(found!=null){try{Node node=resolve(found);if(node.entry.id.equals(id))return found;}catch(Missing ignored){}}
        ArrayDeque<Node> queue=new ArrayDeque<>();queue.add(root());Set<String> seen=new HashSet<>();int count=0;
        while(!queue.isEmpty()){
            MediaSources.interrupted();Node current=queue.remove();if(!seen.add(current.entry.id))continue;
            if(seen.size()>200)throw new IllegalStateException("所选夸克文件夹过大，请选择更小的影视目录。");
            for(Node node:childNodes(current)){if(++count>10000)throw new IllegalStateException("所选夸克目录过大，请先缩小范围。");if(node.entry.id.equals(id))return node.path;if(node.entry.directory&&node.path.split("/").length<16)queue.add(node);}
        }
        throw new Missing();
    }
    byte[] propfind(Node node,String base,boolean includeChildren) throws Exception {
        StringBuilder xml=new StringBuilder("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">");response(xml,node,base);
        if(includeChildren)for(Node child:childNodes(node))response(xml,child,base);
        return xml.append("</d:multistatus>").toString().getBytes(StandardCharsets.UTF_8);
    }
    private static void response(StringBuilder xml,Node node,String base){
        xml.append("<d:response><d:href>").append(escape(base+node.path)).append("</d:href><d:propstat><d:prop><d:displayname>").append(escape(node.entry.name)).append("</d:displayname><d:resourcetype>");
        if(node.entry.directory)xml.append("<d:collection/>");
        xml.append("</d:resourcetype>");if(!node.entry.directory)xml.append("<d:getcontentlength>").append(Math.max(0,node.entry.size)).append("</d:getcontentlength>");
        xml.append("</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");
    }
    private static String escape(String value){StringBuilder safe=new StringBuilder();for(int n=0;n<value.length();n++){char c=value.charAt(n);if(c>=32||c=='\t'||c=='\n'||c=='\r')safe.append(c);}return safe.toString().replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;");}
}
