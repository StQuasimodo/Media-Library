package io.mycinema.tv;

import java.io.Closeable;
import java.io.IOException;
import java.util.*;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

/** One static VOD graph and refresh lineage; no upstream URL is exported to a decoder. */
final class CloudHlsSession implements Closeable {
    interface Provider {MediaSources.Lease resolve(NetworkScope scope)throws Exception;}
    static final class Node {
        final int id,parent,index,depth;final boolean playlist;HttpUrl url;int generation;String fingerprint="";List<Integer> children=new ArrayList<>();
        Node(int id,int parent,int index,int depth,boolean playlist,HttpUrl url,int generation){this.id=id;this.parent=parent;this.index=index;this.depth=depth;this.playlist=playlist;this.url=url;this.generation=generation;}
        String path(){return Integer.toString(id,36)+(playlist?".m3u8":".bin");}
    }
    /** Lineage follows the exact lease, including a rejected request already evicted from the LRU. */
    private static final class ResourceLease extends MediaSources.Lease {
        final MediaSources.Lease owner;
        ResourceLease(HttpUrl url,MediaSources.Lease owner){
            super(url,owner.headers,owner::requestHeaders,LeaseLifetime.quark(url.queryParameter("Expires"),System.currentTimeMillis(),System.nanoTime()),true);
            this.owner=owner;
        }
    }
    private final Provider provider;private final String base;
    private final List<Node> nodes=new ArrayList<>();private final LinkedHashMap<Integer,byte[]> manifests=new LinkedHashMap<>(8,0.75f,true);
    private MediaSources.Lease root;private HttpUrl origin;private int generation;private boolean closed;
    CloudHlsSession(Provider provider,String base){this.provider=provider;this.base=base;nodes.add(new Node(0,-1,-1,0,true,null,0));}
    private void check(NetworkScope scope)throws IOException{scope.check();if(closed)throw new IOException("Cloud playback stopped");}
    private void root(MediaSources.Lease rejected,NetworkScope scope)throws Exception {
        check(scope);if(root==null||root==rejected||root.expired()){
            MediaSources.Lease fresh=provider.resolve(scope);check(scope);
            if(!fresh.url.isHttps()||origin!=null&&!MediaSources.sameOrigin(origin,fresh.url))throw new IOException("Cloud origin changed; reconnect required");
            if(origin==null)origin=fresh.url;root=fresh;generation++;Node first=nodes.get(0);first.url=fresh.url;first.generation=generation;manifests.clear();
        }
    }
    private Node node(String path)throws IOException{for(Node node:nodes)if(node.path().equals(path))return node;throw new IOException("Unknown cloud route");}
    synchronized boolean playlist(String path)throws IOException{return node(path).playlist;}
    private void current(Node node,NetworkScope scope)throws Exception {root(null,scope);if(node.generation!=generation){manifest(nodes.get(node.parent),scope);if(node.generation!=generation)throw new IOException("Stale cloud route");}}
    private NetworkScope.Exchange request(HttpUrl target,String range,NetworkScope scope)throws Exception {
        HttpUrl url=target;
        for(int i=0;i<4;i++){
            check(scope);Request.Builder request=new Request.Builder().url(url).header("Accept-Encoding","identity");
            for(Map.Entry<String,String> header:root.requestHeaders().entrySet())if(Arrays.asList("Cookie","Referer","User-Agent").contains(header.getKey()))request.header(header.getKey(),header.getValue());
            if(!range.isEmpty())request.header("Range",range);
            NetworkScope.Exchange exchange=scope.open(MediaSources.HTTP,request.build());Response response=exchange.response;
            if(response.code()<300||response.code()>=400)return exchange;
            String location=response.header("Location");HttpUrl next=location==null?null:url.resolve(location);exchange.close();
            if(next==null||!MediaSources.sameOrigin(origin,next)||!next.isHttps()||!next.username().isEmpty()||!next.password().isEmpty()||next.fragment()!=null)throw new IOException("Unsafe cloud redirect");url=next;
        }
        throw new IOException("Cloud redirect limit exceeded");
    }
    private byte[] manifest(Node node,NetworkScope scope)throws Exception {
        current(node,scope);byte[] cached=manifests.get(node.id);if(cached!=null)return cached;
        MediaSources.Lease before=root;
        for(int attempt=0;attempt<2;attempt++){
            try(NetworkScope.Exchange exchange=request(node.url,"",scope)){
                Response response=exchange.response;
                if((response.code()==401||response.code()==403)&&attempt==0){exchange.close();root(before,scope);current(node,scope);continue;}
                if(response.code()!=200||!response.header("Content-Encoding","identity").equalsIgnoreCase("identity"))throw new IOException("Cloud playlist unavailable");
                byte[] bytes=TmdbClient.read(response.body().byteStream(),262144);HttpUrl actual=response.request().url();check(scope);
                HlsPlaylist.Parsed parsed=HlsPlaylist.rewrite(bytes,actual,(index,url,playlist)->"resource-"+index);
                if(!node.fingerprint.isEmpty()&&!node.fingerprint.equals(parsed.fingerprint))throw new IOException("Cloud VOD changed during refresh");
                if(node.children.isEmpty()){
                    if(nodes.size()+parsed.references.size()>4096||node.depth>=4)throw new IOException("Cloud graph limit exceeded");
                    for(HlsPlaylist.Reference ref:parsed.references){for(Node ancestor=node;;ancestor=nodes.get(ancestor.parent)){if(ref.playlist&&HlsPlaylist.identity(ref.url).equals(HlsPlaylist.identity(ancestor.url)))throw new IOException("Cyclic cloud playlist");if(ancestor.parent<0)break;}}
                    for(int i=0;i<parsed.references.size();i++){HlsPlaylist.Reference ref=parsed.references.get(i);int id=nodes.size();node.children.add(id);nodes.add(new Node(id,node.id,i,node.depth+1,ref.playlist,ref.url,generation));}
                }
                if(node.children.size()!=parsed.references.size())throw new IOException("Cloud graph changed");
                for(int i=0;i<node.children.size();i++){Node child=nodes.get(node.children.get(i));child.url=parsed.references.get(i).url;child.generation=generation;}
                node.fingerprint=parsed.fingerprint;
                byte[] local=HlsPlaylist.rewrite(bytes,actual,(index,url,playlist)->base+nodes.get(node.children.get(index)).path()).body;
                if(local.length>524288)throw new IOException("Rewritten HLS playlist too large");
                manifests.put(node.id,local);while(manifests.size()>8)manifests.remove(manifests.keySet().iterator().next());return local;
            }
        }
        throw new IOException("Cloud playlist authentication failed");
    }
    synchronized byte[] manifest(String path,NetworkScope scope)throws Exception {Node node=node(path);if(!node.playlist)throw new IOException("Not a playlist");return manifest(node,scope);}
    synchronized MediaSources.Lease resource(JSONObject file,MediaSources.Lease rejected,NetworkScope scope)throws Exception {
        Node node=node(Json.text(file,"fileId"));if(node.playlist)throw new IOException("Not a binary resource");
        // Cache misses reuse a valid graph. Only the root that issued a rejected/expired lease is renewed.
        root(rejected instanceof ResourceLease?((ResourceLease)rejected).owner:null,scope);current(node,scope);
        return new ResourceLease(node.url,root);
    }
    @Override public synchronized void close(){closed=true;manifests.clear();nodes.clear();root=null;}
}
