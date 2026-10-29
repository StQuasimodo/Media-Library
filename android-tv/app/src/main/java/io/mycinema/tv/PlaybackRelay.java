package io.mycinema.tv;

import android.util.Base64;
import org.json.JSONObject;
import java.io.BufferedInputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;

/** Loopback HTTP/DAV protocol adapter. MediaTransfer owns all upstream streaming policy. */
final class PlaybackRelay implements Closeable {
    private final JSONObject file;private final QuarkDavTree dav;private final ServerSocket server;
    private final String token=UUID.randomUUID().toString(),password=UUID.randomUUID().toString();
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(3,3,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
    private final Set<Socket> sockets=new HashSet<>();private final Set<NetworkScope> requests=new HashSet<>();
    private final Map<String,Session> sessions=new LinkedHashMap<>();
    private final MediaTransfer transfer;
    private volatile boolean closed;private volatile String error="";
    PlaybackRelay(MediaSources sources,JSONObject file) throws Exception {this(sources,Json.copy(file),null);}
    PlaybackRelay(MediaSources sources,QuarkDavTree tree) throws Exception {this(sources,null,tree);}
    private PlaybackRelay(MediaSources sources,JSONObject file,QuarkDavTree dav) throws Exception {
        this.file=file;this.dav=dav;
        transfer=new MediaTransfer((target,scope)->{MediaSources driver=sources.withScope(scope);return dav==null?driver.resolveForPlayback(target):driver.resolve(target);});
        server=new ServerSocket(0,4,InetAddress.getByName("127.0.0.1"));
        Thread acceptor=new Thread(()->{while(!closed)try{Socket socket=server.accept();socket.setSoTimeout(15000);synchronized(sockets){sockets.add(socket);}try{workers.execute(()->serve(socket));}catch(java.util.concurrent.RejectedExecutionException rejected){socket.close();synchronized(sockets){sockets.remove(socket);}}}catch(IOException ignored){if(!closed)error="本机播放连接中断。";}},"cinema-playback-relay");acceptor.setDaemon(true);acceptor.start();
    }
    String url(){return "http://127.0.0.1:"+server.getLocalPort()+"/"+token+(dav==null?"":"/");}
    String username(){return "cinema";}
    String password(){return password;}
    String authorization(){return "Basic "+Base64.encodeToString((username()+":"+password).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);}
    final class Session implements Closeable {
        final MediaSources.Lease endpoint;final String fileId,auth;
        private final Set<NetworkScope> owned=new HashSet<>();private boolean ended;
        private Session(String fileId,HttpUrl url){this.fileId=fileId;auth="Basic "+Base64.encodeToString(("playback:"+UUID.randomUUID()).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);Map<String,String> headers=new LinkedHashMap<>();headers.put("Authorization",auth);endpoint=new MediaSources.Lease(url,headers);}
        private synchronized void attach(NetworkScope scope) throws IOException {if(ended)throw new IOException("Playback session ended");owned.add(scope);}
        private synchronized void detach(NetworkScope scope){owned.remove(scope);}
        @Override public void close(){
            synchronized(sessions){sessions.remove(auth);}
            synchronized(this){if(ended)return;ended=true;for(NetworkScope scope:owned)scope.close();owned.clear();}
        }
    }
    Session openSession(String fileId,HttpUrl endpoint) throws IOException {
        synchronized(sessions){if(closed||sessions.size()>=4)throw new IOException("Playback session unavailable");Session session=new Session(fileId,endpoint);sessions.put(session.auth,session);return session;}
    }
    String error(){String streaming=transfer.error();return streaming.isEmpty()?error:streaming;}
    String error(JSONObject target){return transfer.error(target);}
    int recoveries(){return transfer.recoveries();}
    int segments(){return transfer.segments();}
    int activeRequests(){synchronized(requests){return requests.size();}}
    boolean idle(){return workers.getActiveCount()==0&&workers.getQueue().isEmpty();}
    private static String value(Map<String,String> headers,String key,String fallback){String value=headers.get(key);return value==null?fallback:value;}
    private static String line(InputStream input) throws IOException {StringBuilder line=new StringBuilder();for(int n=0;n<8192;n++){int ch=input.read();if(ch<0)throw new IOException();if(ch=='\n')return line.toString().replace("\r","");line.append((char)ch);}throw new IOException();}
    private void serve(Socket socket){
        NetworkScope scope=new NetworkScope();Session session=null;synchronized(requests){if(closed)scope.close();requests.add(scope);}
        try(NetworkScope requestScope=scope;Socket client=socket){try{scope.check();InputStream input=new BufferedInputStream(client.getInputStream());OutputStream output=client.getOutputStream();String[] request=line(input).split(" ");
            if(request.length!=3||!request[2].matches("HTTP/1\\.[01]")){status(output,400);return;}
            Map<String,String> headers=new LinkedHashMap<>();int bytes=0;for(int count=0;count<40;count++){String header=line(input);bytes+=header.length();if(bytes>16384)throw new IOException();if(header.isEmpty())break;if(count==39)throw new IOException();int colon=header.indexOf(':');if(colon<=0)throw new IOException();String key=header.substring(0,colon).trim().toLowerCase(java.util.Locale.ROOT);if(headers.put(key,header.substring(colon+1).trim())!=null){status(output,400);return;}}
            String method=request[0],path=request[1];JSONObject target=file;
            if(dav!=null){
                String auth=value(headers,"authorization","");boolean baseAuth=MessageDigest.isEqual(authorization().getBytes(StandardCharsets.US_ASCII),auth.getBytes(StandardCharsets.UTF_8));
                if(!baseAuth){synchronized(sessions){session=sessions.get(auth);}if(session==null){reply(output,401,"","",new byte[0],"WWW-Authenticate: Basic realm=\"My Cinema Quark WebDAV\"\r\n");return;}session.attach(scope);}
                String base="/"+token+"/";if(!path.startsWith(base)){status(output,404);return;}
                if(!method.equals("OPTIONS")&&!method.equals("PROPFIND")&&!method.equals("GET")&&!method.equals("HEAD")){reply(output,405,"","",new byte[0],"Allow: OPTIONS, PROPFIND, GET, HEAD\r\n");return;}
                if(headers.containsKey("transfer-encoding")){status(output,501);return;}
                long body=0;try{body=Long.parseLong(value(headers,"content-length","0"));}catch(NumberFormatException invalid){status(output,400);return;}if(body<0||body>65536){status(output,413);return;}
                if(headers.containsKey("expect")){status(output,417);return;}
                byte[] buffer=new byte[4096];while(body>0){int read=input.read(buffer,0,(int)Math.min(buffer.length,body));if(read<0)throw new IOException();body-=read;}
                QuarkDavTree.Node node=dav.resolve(path.substring(base.length()),scope);
                if(session!=null&&(!session.fileId.equals(node.entry.id)||node.entry.directory||!method.equals("GET")&&!method.equals("HEAD"))){status(output,403);return;}
                if(method.equals("OPTIONS")){reply(output,200,"","",new byte[0],"DAV: 1\r\nAllow: OPTIONS, PROPFIND, GET, HEAD\r\n");return;}
                if(method.equals("PROPFIND")){String depth=value(headers,"depth","1");if(!depth.equals("0")&&!depth.equals("1")){reply(output,depth.equalsIgnoreCase("infinity")?403:400,"","application/xml; charset=utf-8","<?xml version=\"1.0\"?><d:error xmlns:d=\"DAV:\"><d:propfind-finite-depth/></d:error>".getBytes(StandardCharsets.UTF_8),"");return;}byte[] xml=dav.propfind(node,base,depth.equals("1"),scope);reply(output,207,"","application/xml; charset=utf-8",xml,"DAV: 1\r\n");return;}
                if(node.entry.directory){status(output,405);return;}target=node.entry.json();
            }else if(!path.equals("/"+token)||!(method.equals("GET")||method.equals("HEAD"))){status(output,404);return;}
            transfer.serve(target,value(headers,"range",""),method.equals("HEAD"),output,scope);
        }catch(QuarkDavTree.Missing missing){try{status(socket.getOutputStream(),404);}catch(IOException ignored){}}
        catch(Exception failure){if(!closed){error="媒体读取中断，有限重试未能完成。请检查网络、登录状态或更换资源后重试。";try{status(socket.getOutputStream(),502);}catch(IOException ignored){}}}
        }catch(IOException ignored){}
        finally{if(session!=null)session.detach(scope);synchronized(sockets){sockets.remove(socket);}synchronized(requests){requests.remove(scope);}}
    }
    private static void reply(OutputStream output,int code,String reason,String type,byte[] body,String extra) throws IOException {
        String headers="HTTP/1.1 "+code+" "+(reason.isEmpty()?"WebDAV":reason)+"\r\nConnection: close\r\nContent-Length: "+body.length+"\r\n"+(type.isEmpty()?"":"Content-Type: "+type+"\r\n")+extra+"\r\n";output.write(headers.getBytes(StandardCharsets.US_ASCII));output.write(body);output.flush();
    }
    private static void status(OutputStream output,int code) throws IOException {reply(output,code,"","",new byte[0],"");}
    @Override public void close(){closed=true;try{server.close();}catch(IOException ignored){}ArrayList<Session> active;synchronized(sessions){active=new ArrayList<>(sessions.values());}for(Session session:active)session.close();synchronized(requests){for(NetworkScope scope:requests)scope.close();requests.clear();}transfer.close();synchronized(sockets){for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}sockets.clear();}workers.shutdownNow();}
}
