package io.mycinema.tv;

import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.HttpUrl;
import org.json.JSONObject;

/** Short-lived authenticated loopback endpoint for one selected HLS VOD. */
final class CloudHlsRelay implements Closeable {
    private final ServerSocket server;private final String prefix="/"+UUID.randomUUID()+"/",password=UUID.randomUUID().toString();
    private final Set<Socket> sockets=new HashSet<>();private final Set<NetworkScope> requests=new HashSet<>();
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(3,3,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
    private final CloudHlsSession session;private final MediaTransfer transfer;private volatile boolean closed;private volatile String error="";
    CloudHlsRelay(MediaSources sources,JSONObject file,String selector)throws Exception {
        server=new ServerSocket(0,4,InetAddress.getByName("127.0.0.1"));String base="http://127.0.0.1:"+server.getLocalPort()+prefix;
        session=new CloudHlsSession(scope->sources.withScope(scope).cloudHls(file,selector),base);
        transfer=new MediaTransfer(new MediaTransfer.Provider(){
            public MediaSources.Lease resolve(JSONObject target,NetworkScope scope)throws Exception{return session.resource(target,null,scope);}
            public MediaSources.Lease refresh(JSONObject target,MediaSources.Lease rejected,NetworkScope scope)throws Exception{return session.resource(target,rejected,scope);}
        });
        Thread acceptor=new Thread(()->{while(!closed)try{Socket client=server.accept();client.setSoTimeout(15000);synchronized(sockets){sockets.add(client);}try{workers.execute(()->serve(client));}catch(RejectedExecutionException rejected){client.close();synchronized(sockets){sockets.remove(client);}}}catch(IOException ignored){if(!closed)error="云端试播连接中断。";}},"cinema-cloud-hls");acceptor.setDaemon(true);acceptor.start();
    }
    void prepare(NetworkScope scope)throws Exception {session.manifest("0.m3u8",scope);}
    MediaSources.Lease endpoint(){Map<String,String> headers=new LinkedHashMap<>();headers.put("Authorization",authorization());return new MediaSources.Lease(HttpUrl.parse("http://127.0.0.1:"+server.getLocalPort()+prefix+"0.m3u8"),headers);}
    private String authorization(){return "Basic "+Base64.encodeToString(("cinema:"+password).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);}
    String error(){return error.isEmpty()?transfer.error():error;}
    int recoveries(){return transfer.recoveries();}
    private static String value(Map<String,String> headers,String key,String fallback){String value=headers.get(key);return value==null?fallback:value;}
    private static String line(InputStream input)throws IOException {StringBuilder out=new StringBuilder();for(int i=0;i<8192;i++){int c=input.read();if(c<0)throw new IOException();if(c=='\n')return out.toString().replace("\r","");out.append((char)c);}throw new IOException();}
    private static void reply(OutputStream out,int status,byte[] body,boolean head)throws IOException {
        out.write(("HTTP/1.1 "+status+" HLS\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: "+body.length+"\r\n"+(status==401?"WWW-Authenticate: Basic realm=\"My Cinema Cloud HLS\"\r\n":"")+"\r\n").getBytes(StandardCharsets.US_ASCII));if(!head)out.write(body);out.flush();
    }
    private void serve(Socket socket){
        NetworkScope scope=new NetworkScope();synchronized(requests){if(closed)scope.close();requests.add(scope);}
        try(Socket client=socket;NetworkScope owned=scope){
            OutputStream output=client.getOutputStream();boolean wrote=false;
            try{
                scope.check();InputStream input=new BufferedInputStream(client.getInputStream());String[] start=line(input).split(" ");if(start.length!=3||!start[2].matches("HTTP/1\\.[01]")){reply(output,400,new byte[0],false);return;}
                Map<String,String> headers=new HashMap<>();int bytes=0;for(int i=0;i<40;i++){String row=line(input);bytes+=row.length();if(row.isEmpty())break;if(i==39||bytes>16384)throw new IOException();int colon=row.indexOf(':');if(colon<=0||headers.put(row.substring(0,colon).trim().toLowerCase(Locale.ROOT),row.substring(colon+1).trim())!=null){reply(output,400,new byte[0],false);return;}}
                if(!MessageDigest.isEqual(authorization().getBytes(StandardCharsets.UTF_8),value(headers,"authorization","").getBytes(StandardCharsets.UTF_8))){reply(output,401,new byte[0],false);return;}
                boolean head=start[0].equals("HEAD");if(!head&&!start[0].equals("GET")){reply(output,405,new byte[0],false);return;}
                if(headers.containsKey("transfer-encoding")||!value(headers,"content-length","0").equals("0")){reply(output,400,new byte[0],head);return;}
                if(!start[1].startsWith(prefix)){reply(output,404,new byte[0],head);return;}String route=start[1].substring(prefix.length());if(!route.matches("[0-9a-z]+\\.(?:m3u8|bin)")){reply(output,404,new byte[0],head);return;}
                String range=value(headers,"range","");
                if(session.playlist(route)){
                    if(!range.isEmpty()){reply(output,416,new byte[0],head);return;}byte[] body=session.manifest(route,scope);wrote=true;reply(output,200,body,head);
                }else{JSONObject target=new JSONObject();Json.put(target,"source","quark");Json.put(target,"_cloudHls",true);Json.put(target,"fileId",route);wrote=true;transfer.serve(target,range,head,output,scope);}
            }catch(Exception failure){if(!scope.cancelled()&&!closed&&!wrote){error="云端HLS版本不可用或发生变化，请重连或返回原文件。";try{reply(output,502,new byte[0],false);}catch(IOException ignored){}}}
        }catch(IOException ignored){}finally{synchronized(requests){requests.remove(scope);}synchronized(sockets){sockets.remove(socket);}}
    }
    @Override public void close(){
        closed=true;try{server.close();}catch(IOException ignored){}List<NetworkScope> pending;synchronized(requests){pending=new ArrayList<>(requests);}for(NetworkScope scope:pending)scope.close();
        synchronized(sockets){for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}}
        workers.shutdownNow();transfer.close();session.close();
    }
}
