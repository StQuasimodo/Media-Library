package io.mycinema.tv;

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
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;

/** Bounded loopback transport: Range passes through, expiring Quark URLs renew once. */
final class PlaybackRelay implements Closeable {
    private final MediaSources sources;private final JSONObject file;private final ServerSocket server;
    private final String token=UUID.randomUUID().toString();
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
    private final Set<Socket> sockets=new HashSet<>();private final Set<Call> calls=new HashSet<>();
    private volatile boolean closed;private volatile String error="";private MediaSources.Lease lease;
    PlaybackRelay(MediaSources sources,JSONObject file) throws Exception {
        this.sources=sources;this.file=Json.copy(file);server=new ServerSocket(0,4,InetAddress.getByName("127.0.0.1"));
        Thread acceptor=new Thread(()->{while(!closed)try{Socket socket=server.accept();socket.setSoTimeout(15000);synchronized(sockets){sockets.add(socket);}try{workers.execute(()->serve(socket));}catch(java.util.concurrent.RejectedExecutionException rejected){socket.close();synchronized(sockets){sockets.remove(socket);}}}catch(IOException ignored){if(!closed)error="本机播放连接中断。";}},"cinema-playback-relay");acceptor.setDaemon(true);acceptor.start();
    }
    String url(){return "http://127.0.0.1:"+server.getLocalPort()+"/"+token;}
    String error(){return error;}
    private synchronized MediaSources.Lease lease(boolean renew) throws Exception {if(closed)throw new IOException();if(lease==null||renew)lease=sources.resolve(file);return lease;}
    private Response upstream(MediaSources.Lease current,String range,boolean head,java.util.List<Call> owned) throws Exception {
        HttpUrl url=current.url;
        for(int redirects=0;redirects<=4;redirects++){
            if(closed)throw new IOException();Request.Builder builder=new Request.Builder().url(url).method(head?"HEAD":"GET",null).header("Accept-Encoding","identity");
            if(MediaSources.sameOrigin(url,current.url))for(java.util.Map.Entry<String,String> header:current.headers.entrySet())builder.header(header.getKey(),header.getValue());
            if(!range.isEmpty())builder.header("Range",range);
            Call call=MediaSources.HTTP.newCall(builder.build());owned.add(call);synchronized(calls){if(closed)throw new IOException();calls.add(call);}
            Response response;try{response=call.execute();}catch(Exception failure){synchronized(calls){calls.remove(call);}throw failure;}
            if(response.code()>=300&&response.code()<400){String location=response.header("Location");HttpUrl next=location==null?null:url.resolve(location);response.close();synchronized(calls){calls.remove(call);}
                if(next==null||(current.url.isHttps()&&!next.isHttps())||!next.username().isEmpty()||!next.password().isEmpty())throw new IllegalStateException("播放地址重定向无效。");url=next;continue;}
            return response;
        }throw new IllegalStateException("播放地址重定向过多。");
    }
    private static String line(InputStream input) throws IOException {StringBuilder line=new StringBuilder();for(int n=0;n<4096;n++){int ch=input.read();if(ch<0)throw new IOException();if(ch=='\n')return line.toString().replace("\r","");line.append((char)ch);}throw new IOException();}
    private void serve(Socket socket){
        java.util.List<Call> owned=new java.util.ArrayList<>();
        try(Socket client=socket){InputStream input=new BufferedInputStream(client.getInputStream());OutputStream output=client.getOutputStream();String[] request=line(input).split(" ");
            if(request.length!=3||!request[1].equals("/"+token)||!(request[0].equals("GET")||request[0].equals("HEAD"))){status(output,404);return;}
            String range="";int bytes=0;for(int count=0;count<40;count++){String header=line(input);bytes+=header.length();if(bytes>16384)throw new IOException();if(header.isEmpty())break;if(count==39)throw new IOException();if(header.toLowerCase(java.util.Locale.ROOT).startsWith("range:"))range=header.substring(6).trim();}
            if(!range.isEmpty()&&!range.matches("bytes=\\d*-\\d*")){status(output,416);return;}
            Response upstream=upstream(lease(false),range,request[0].equals("HEAD"),owned);
            if((upstream.code()==401||upstream.code()==403)&&Json.text(file,"source").equals("quark")){upstream.close();upstream=upstream(lease(true),range,request[0].equals("HEAD"),owned);}
            try(Response response=upstream){
                if(response.code()!=200&&response.code()!=206&&response.code()!=416){error="视频读取失败（HTTP "+response.code()+"），请检查账号权限或重新连接媒体源。";status(output,502);return;}
                StringBuilder headers=new StringBuilder("HTTP/1.1 "+response.code()+" Playback\r\nConnection: close\r\n");
                for(String key:new String[]{"Content-Length","Content-Range","Content-Type","Accept-Ranges"}){String value=response.header(key);if(value!=null&&!value.contains("\r")&&!value.contains("\n"))headers.append(key).append(": ").append(value).append("\r\n");}
                output.write(headers.append("\r\n").toString().getBytes(StandardCharsets.US_ASCII));
                if(!request[0].equals("HEAD")){byte[] buffer=new byte[65536];InputStream stream=response.body().byteStream();int length;while(!closed&&(length=stream.read(buffer))>=0)output.write(buffer,0,length);}output.flush();
            }
        }catch(Exception failure){if(!closed&&failure instanceof IllegalStateException)error=failure.getMessage();}
        finally{synchronized(sockets){sockets.remove(socket);}synchronized(calls){calls.removeAll(owned);}}
    }
    private static void status(OutputStream output,int code) throws IOException {output.write(("HTTP/1.1 "+code+" Playback\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));}
    @Override public void close(){closed=true;try{server.close();}catch(IOException ignored){}synchronized(calls){for(Call call:calls)call.cancel();calls.clear();}synchronized(sockets){for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}sockets.clear();}workers.shutdownNow();}
}
