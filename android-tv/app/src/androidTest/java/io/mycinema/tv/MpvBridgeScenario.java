package io.mycinema.tv;

import android.content.Context;
import is.xyz.mpv.MPVLib;
import org.json.JSONObject;
import okhttp3.Request;
import okhttp3.Response;

/** Test-only integration: mpv uses the application's scoped, revocable loopback lease. */
final class MpvBridgeScenario {
    private interface Condition { boolean ok(); }
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static void await(Condition condition,String label) throws Exception {
        long end=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<end){if(condition.ok())return;Thread.sleep(250);}
        throw new AssertionError("timeout: "+label);
    }
    private static double time(MPVLib mpv){Double t=mpv.getPropertyDouble("time-pos");return t==null?-1:t;}
    private static void option(MPVLib mpv,String key,String value){check(mpv.setOptionString(key,value)>=0,"mpv option "+key);}
    static void run(Context context,JSONObject file) throws Exception {
        NetworkScope scope=new NetworkScope();PlaybackRelay.Session session=null;MPVLib mpv=null;boolean created=false;
        try{
            session=CinemaApplication.dav(context).openPlayback(file,scope);
            check("127.0.0.1".equals(session.endpoint.url.host()),"mpv source is loopback");
            mpv=new MPVLib();final MPVLib engine=mpv;mpv.create(context);created=true;
            // Suppress verbose native option logging before supplying the ephemeral relay credential.
            option(mpv,"msg-level","all=no");option(mpv,"vo","null");option(mpv,"ao","null");
            option(mpv,"hwdec","auto");option(mpv,"hwdec-software-fallback","1");
            option(mpv,"http-header-fields","Authorization: "+session.endpoint.headers.get("Authorization"));
            option(mpv,"idle","yes");mpv.init();
            mpv.command(new String[]{"loadfile",session.endpoint.url.toString()});
            await(()->time(engine)>1.5,"mpv advances on scoped Quark stream");
            await(()->{Integer w=engine.getPropertyInt("width");Integer h=engine.getPropertyInt("height");return w!=null&&h!=null&&w==1920&&h==1080;},"mpv decodes fixture dimensions");
            mpv.setPropertyBoolean("pause",true);Thread.sleep(800);double paused=time(mpv);Thread.sleep(800);
            check(Math.abs(time(mpv)-paused)<0.5,"mpv pause holds");
            mpv.command(new String[]{"seek","20","absolute+exact"});await(()->Math.abs(time(engine)-20)<1.5,"mpv seek through scoped relay");
            mpv.setPropertyBoolean("pause",false);await(()->time(engine)>21,"mpv resumes after seek");
            mpv.destroy();created=false;
            okhttp3.HttpUrl url=session.endpoint.url;String auth=session.endpoint.headers.get("Authorization");session.close();session=null;
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(url).header("Authorization",auth).build()).execute()){
                check(response.code()==401,"closing session revokes mpv access");
            }
        }finally{if(created&&mpv!=null)mpv.destroy();if(session!=null)session.close();scope.close();}
    }
}
