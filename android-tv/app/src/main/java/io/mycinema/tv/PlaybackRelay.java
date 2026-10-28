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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;

/** Bounded loopback transport, with an optional real read-only Quark WebDAV endpoint. */
final class PlaybackRelay implements Closeable {
    private final MediaSources sources;private final JSONObject file;private final QuarkDavTree dav;private final ServerSocket server;
    private final String token=UUID.randomUUID().toString(),password=UUID.randomUUID().toString();
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(3,3,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
    private final Set<Socket> sockets=new HashSet<>();private final Set<Call> calls=new HashSet<>();
    private final LinkedHashMap<String,MediaSources.Lease> leases=new LinkedHashMap<>(8,0.75f,true);
    private volatile boolean closed;private volatile String error="";
    PlaybackRelay(MediaSources sources,JSONObject file) throws Exception {this(sources,Json.copy(file),null);}
    PlaybackRelay(MediaSources sources,QuarkDavTree tree) throws Exception {this(sources,null,tree);}
    private PlaybackRelay(MediaSources sources,JSONObject file,QuarkDavTree dav) throws Exception {
        this.sources=sources;this.file=file;this.dav=dav;server=new ServerSocket(0,4,InetAddress.getByName("127.0.0.1"));
        Thread acceptor=new Thread(()->{while(!closed)try{Socket socket=server.accept();socket.setSoTimeout(15000);synchronized(sockets){sockets.add(socket);}try{workers.execute(()->serve(socket));}catch(java.util.concurrent.RejectedExecutionException rejected){socket.close();synchronized(sockets){sockets.remove(socket);}}}catch(IOException ignored){if(!closed)error="本机播放连接中断。";}},"cinema-playback-relay");acceptor.setDaemon(true);acceptor.start();
    }
    String url(){return "http://127.0.0.1:"+server.getLocalPort()+"/"+token+(dav==null?"":"/");}
    String username(){return "cinema";}
    String password(){return password;}
    String authorization(){return "Basic "+Base64.encodeToString((username()+":"+password).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);}
    String error(){return error;}
    private synchronized MediaSources.Lease lease(JSONObject target,boolean renew) throws Exception {
        if(closed)throw new IOException();String key=Json.text(target,"source")+":"+Json.text(target,"fileId");MediaSources.Lease found=leases.get(key);
        if(found==null||renew){found=dav==null?sources.resolveForPlayback(target):sources.resolve(target);leases.put(key,found);while(leases.size()>8)leases.remove(leases.keySet().iterator().next());}return found;
    }
    private Response upstream(MediaSources.Lease current,String range,boolean head,List<Call> owned) throws Exception {
        HttpUrl url=current.url;
        for(int redirects=0;redirects<=4;redirects++){
            if(closed)throw new IOException();Request.Builder builder=new Request.Builder().url(url).method(head?"HEAD":"GET",null).header("Accept-Encoding","identity");
            if(MediaSources.sameOrigin(url,current.url))for(Map.Entry<String,String> header:current.headers.entrySet())builder.header(header.getKey(),header.getValue());
            if(!range.isEmpty())builder.header("Range",range);
            Call call=MediaSources.HTTP.newCall(builder.build());owned.add(call);synchronized(calls){if(closed)throw new IOException();calls.add(call);}
            Response response;try{response=call.execute();}catch(Exception failure){synchronized(calls){calls.remove(call);}throw failure;}
            if(response.code()>=300&&response.code()<400){String location=response.header("Location");HttpUrl next=location==null?null:url.resolve(location);response.close();synchronized(calls){calls.remove(call);}
                if(next==null||(current.url.isHttps()&&!next.isHttps())||!next.username().isEmpty()||!next.password().isEmpty())throw new IllegalStateException("播放地址重定向无效。");url=next;continue;}
            return response;
        }throw new IllegalStateException("播放地址重定向过多。");
    }
    private static String value(Map<String,String> headers,String key,String fallback){String value=headers.get(key);return value==null?fallback:value;}
    private static String line(InputStream input) throws IOException {StringBuilder line=new StringBuilder();for(int n=0;n<8192;n++){int ch=input.read();if(ch<0)throw new IOException();if(ch=='\n')return line.toString().replace("\r","");line.append((char)ch);}throw new IOException();}
    private void serve(Socket socket){
        List<Call> owned=new ArrayList<>();
        try(Socket client=socket){try{InputStream input=new BufferedInputStream(client.getInputStream());OutputStream output=client.getOutputStream();String[] request=line(input).split(" ");
            if(request.length!=3||!request[2].matches("HTTP/1\\.[01]")){status(output,400);return;}
            Map<String,String> headers=new LinkedHashMap<>();int bytes=0;for(int count=0;count<40;count++){String header=line(input);bytes+=header.length();if(bytes>16384)throw new IOException();if(header.isEmpty())break;if(count==39)throw new IOException();int colon=header.indexOf(':');if(colon<=0)throw new IOException();String key=header.substring(0,colon).trim().toLowerCase(java.util.Locale.ROOT);if(headers.put(key,header.substring(colon+1).trim())!=null){status(output,400);return;}}
            String method=request[0],path=request[1];JSONObject target=file;
            if(dav!=null){
                if(!MessageDigest.isEqual(authorization().getBytes(StandardCharsets.US_ASCII),value(headers,"authorization","").getBytes(StandardCharsets.UTF_8))){reply(output,401,"","",new byte[0],"WWW-Authenticate: Basic realm=\"My Cinema Quark WebDAV\"\r\n");return;}
                String base="/"+token+"/";if(!path.startsWith(base)){status(output,404);return;}
                if(!method.equals("OPTIONS")&&!method.equals("PROPFIND")&&!method.equals("GET")&&!method.equals("HEAD")){reply(output,405,"","",new byte[0],"Allow: OPTIONS, PROPFIND, GET, HEAD\r\n");return;}
                if(headers.containsKey("transfer-encoding")){status(output,501);return;}
                long body=0;try{body=Long.parseLong(value(headers,"content-length","0"));}catch(NumberFormatException invalid){status(output,400);return;}if(body<0||body>65536){status(output,413);return;}
                if(headers.containsKey("expect")){status(output,417);return;}
                byte[] buffer=new byte[4096];while(body>0){int read=input.read(buffer,0,(int)Math.min(buffer.length,body));if(read<0)throw new IOException();body-=read;}
                QuarkDavTree.Node node=dav.resolve(path.substring(base.length()));
                if(method.equals("OPTIONS")){reply(output,200,"","",new byte[0],"DAV: 1\r\nAllow: OPTIONS, PROPFIND, GET, HEAD\r\n");return;}
                if(method.equals("PROPFIND")){String depth=value(headers,"depth","1");if(!depth.equals("0")&&!depth.equals("1")){reply(output,depth.equalsIgnoreCase("infinity")?403:400,"","application/xml; charset=utf-8","<?xml version=\"1.0\"?><d:error xmlns:d=\"DAV:\"><d:propfind-finite-depth/></d:error>".getBytes(StandardCharsets.UTF_8),"");return;}byte[] xml=dav.propfind(node,base,depth.equals("1"));reply(output,207,"","application/xml; charset=utf-8",xml,"DAV: 1\r\n");return;}
                if(node.entry.directory){status(output,405);return;}target=node.entry.json();
            }else if(!path.equals("/"+token)||!(method.equals("GET")||method.equals("HEAD"))){status(output,404);return;}
            String range=value(headers,"range","");if(!range.isEmpty()&&(!range.matches("bytes=\\d*-\\d*")||range.equals("bytes=-"))){status(output,416);return;}
            Response upstream=upstream(lease(target,false),range,method.equals("HEAD"),owned);
            if((upstream.code()==401||upstream.code()==403)&&Json.text(target,"source").equals("quark")){upstream.close();upstream=upstream(lease(target,true),range,method.equals("HEAD"),owned);}
            try(Response response=upstream){
                if(response.code()!=200&&response.code()!=206&&response.code()!=416){error="视频读取失败（HTTP "+response.code()+"），请检查账号权限或重新连接媒体源。";status(output,502);return;}
                StringBuilder responseHeaders=new StringBuilder("HTTP/1.1 "+response.code()+" Playback\r\nConnection: close\r\n");
                for(String key:new String[]{"Content-Length","Content-Range","Content-Type","Accept-Ranges"}){String value=response.header(key);if(value!=null&&!value.contains("\r")&&!value.contains("\n"))responseHeaders.append(key).append(": ").append(value).append("\r\n");}
                output.write(responseHeaders.append("\r\n").toString().getBytes(StandardCharsets.US_ASCII));
                if(!method.equals("HEAD")){byte[] buffer=new byte[65536];InputStream stream=response.body().byteStream();int length;while(!closed&&(length=stream.read(buffer))>=0)output.write(buffer,0,length);}output.flush();
            }
        }catch(QuarkDavTree.Missing missing){try{status(socket.getOutputStream(),404);}catch(IOException ignored){}}
        catch(Exception failure){if(!closed){error="夸克WebDAV读取未完成，请检查登录状态和网络后重试。";try{status(socket.getOutputStream(),502);}catch(IOException ignored){}}}
        }catch(IOException ignored){}
        finally{synchronized(sockets){sockets.remove(socket);}synchronized(calls){calls.removeAll(owned);}}
    }
    private static void reply(OutputStream output,int code,String reason,String type,byte[] body,String extra) throws IOException {
        String headers="HTTP/1.1 "+code+" "+(reason.isEmpty()?"WebDAV":reason)+"\r\nConnection: close\r\nContent-Length: "+body.length+"\r\n"+(type.isEmpty()?"":"Content-Type: "+type+"\r\n")+extra+"\r\n";output.write(headers.getBytes(StandardCharsets.US_ASCII));output.write(body);output.flush();
    }
    private static void status(OutputStream output,int code) throws IOException {reply(output,code,"","",new byte[0],"");}
    @Override public void close(){closed=true;try{server.close();}catch(IOException ignored){}synchronized(calls){for(Call call:calls)call.cancel();calls.clear();}synchronized(sockets){for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}sockets.clear();}workers.shutdownNow();}
}
