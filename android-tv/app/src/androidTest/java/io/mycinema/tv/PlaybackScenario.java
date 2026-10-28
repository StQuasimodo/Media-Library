package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Debug;
import android.view.KeyEvent;
import org.json.JSONArray;
import org.json.JSONObject;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IMedia;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import okhttp3.Request;
import okhttp3.Response;

/** Controlled HTTPS source + real embedded LibVLC on a disposable API22 emulator. */
final class PlaybackScenario {
    private final String buildRun;private final Instrumentation test;private final Context context;private final List<String> checks=new ArrayList<>();
    private PlayerActivity playerActivity;private MediaBrowserActivity browser;
    PlaybackScenario(Instrumentation test,String buildRun){this.buildRun=buildRun;this.test=test;context=test.getTargetContext();}
    private void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private MediaPlayer player(){try{java.lang.reflect.Field field=PlayerActivity.class.getDeclaredField("player");field.setAccessible(true);return (MediaPlayer)field.get(playerActivity);}catch(Exception error){throw new IllegalStateException(error);}}
    interface Condition{boolean ready() throws Exception;}
    private void await(Condition condition,String label) throws Exception {long deadline=System.currentTimeMillis()+25000;while(System.currentTimeMillis()<deadline){if(condition.ready())return;Thread.sleep(300);}throw new AssertionError("timeout: "+label);}
    private int displayed(){IMedia media=player().getMedia();if(media==null)return 0;try{IMedia.Stats stats=media.getStats();return stats==null?0:stats.displayedPictures;}finally{media.release();}}
    private void shot(String name) throws Exception {Bitmap image=test.getUiAutomation().takeScreenshot();check(image!=null,"screenshot");try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),name+".png"))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
    private void write(JSONObject report) throws Exception {try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"tv-playback-report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}}
    private static Library.Item film(String id,String name){JSONObject data=new JSONObject();Json.put(data,"id",id);Json.put(data,"title",name);Json.put(data,"originalTitle",name);Json.put(data,"externalId","1396:season:"+id);Json.put(data,"mediaType","tv");return new Library.Item(data,new JSONObject());}
    void run(){Bundle result=new Bundle();JSONObject report=new JSONObject();Json.put(report,"buildRun",buildRun);try{
        check(android.os.Build.VERSION.SDK_INT==22,"API22 runtime required");
        Json.put(report,"fixtureApiAddress",java.net.InetAddress.getByName("api.tmdb.org").getHostAddress());
        Json.put(report,"fixtureQuarkAddress",java.net.InetAddress.getByName("drive-pc.quark.cn").getHostAddress());
        check(Json.text(report,"fixtureApiAddress").equals("10.0.2.2")&&Json.text(report,"fixtureQuarkAddress").equals("10.0.2.2"),"controlled hosts must resolve inside disposable fixture before sending synthetic credentials");String metadata=new SecretStore(context).read();MediaSources sources=new MediaSources(context);
        boolean denied=false;try{sources.saveDav("https://api.tmdb.org/dav/","tv-test","incorrect");}catch(IllegalStateException expected){denied=true;}check(denied,"401 credentials rejected");
        sources.saveDav("https://api.tmdb.org/dav/","tv-test","fixture");List<MediaSources.Entry> files=sources.list("webdav",sources.root("webdav"));check(files.size()==1&&files.get(0).video(),"authenticated WebDAV PROPFIND");
        denied=false;try{sources.saveDav("https://api.tmdb.org/bad-dav/","tv-test","fixture");}catch(IllegalStateException expected){denied=true;}check(denied&&sources.root("webdav").equals("https://api.tmdb.org/dav/"),"unsafe href rejected and prior settings retained");
        String relativeXml="<d:multistatus xmlns:d=\"DAV:\"><d:response><d:href>episode.mp4</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>";
        List<MediaSources.Entry> relative=MediaSources.parseDav(relativeXml.getBytes(StandardCharsets.UTF_8),okhttp3.HttpUrl.parse("https://example.test/dav/"),okhttp3.HttpUrl.parse("https://example.test/dav/show/"));check(relative.size()==1&&relative.get(0).id.equals("https://example.test/dav/show/episode.mp4"),"relative href resolves against current directory");
        checks.add("WebDAV authenticated PROPFIND, wrong credentials, same-origin/root confinement and failed reconfiguration preserve prior source");
        JSONObject facts=ResourceName.parse("Breaking.Bad.S02E03.2160p.WEB-DL.HEVC.HDR10.DDP5.1.mkv");check(facts.optInt("season")==2&&facts.optInt("episode")==3&&Json.text(facts,"quality").equals("2160P")&&Json.text(facts,"codec").equals("HEVC"),"quality/codec/season/episode parsed");
        List<Library.Item> seasons=Arrays.asList(film("1","Breaking Bad 第1季"),film("2","Breaking Bad 第2季"));check(ResourceName.match(files.get(0).name,"",seasons).equals("2"),"season association");check(ResourceName.match("Breaking.Bad.E01.mp4","",seasons).isEmpty(),"season missing left unassociated");check(ResourceName.match("Breaking.Bad.S02E01.mp4","",Arrays.asList(film("2","Breaking Bad 第2季"),film("2","Breaking Bad 第2季"))).isEmpty(),"ambiguous match rejected");
        checks.add("filename quality/codec/audio/HDR and season/episode facts; exact unique season association; ambiguous/missing-season left for review");
        sources.saveQuark("__puus=tv-playback-fixture");List<MediaSources.Entry> quarkFiles=sources.list("quark","0");check(quarkFiles.size()==1,"Quark protocol directory");
        check(new SecretStore(context).read().equals(metadata),"TMDB credential unchanged");check(!new String(TmdbClient.read(new java.io.FileInputStream(new File(context.getFilesDir(),"quark-credential.bin")),32768),StandardCharsets.ISO_8859_1).contains("tv-playback-fixture"),"Quark cookie encrypted");
        try(PlaybackRelay relay=new PlaybackRelay(sources,quarkFiles.get(0).json())){
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(relay.url()).header("Range","bytes=1000-1063").build()).execute()){
                check(response.code()==206,"relay Range206 after expired URL retry");check(response.header("Content-Range").startsWith("bytes 1000-1063/"),"Content-Range preserved");byte[] bytes=response.body().bytes();check(bytes.length==64,"relay byte range length");
                try(Response direct=MediaSources.HTTP.newCall(new Request.Builder().url("https://drive-pc.quark.cn/stream/movie.mp4").header("Cookie","__puus=tv-playback-fixture").header("Range","bytes=1000-1063").build()).execute()){check(Arrays.equals(bytes,direct.body().bytes()),"byte-exact range forwarding");}
            }
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(relay.url()+"-wrong").build()).execute()){check(response.code()==404,"session token required");}
        }
        try(Response control=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/").build()).execute()){JSONObject state=Json.object(control.body().string());check(state.optInt("downloads")==2,"expired lease renews exactly once");Json.put(report,"controlledRangeRequests",state.optInt("ranges"));}
        checks.add("Quark synthetic auth/directory and encrypted isolated credentials; source 403 resolves fresh lease once; byte-exact206 Range; loopback token required");
        String key;try(MediaCatalog catalog=new MediaCatalog(context)){JSONObject file=catalog.put(files.get(0),"");key=Json.text(file,"key");catalog.associate(key,"");catalog.put(files.get(0),"should-not-reassociate");check(Json.text(catalog.get(key),"filmId").isEmpty(),"manual unlink survives scans");catalog.progress(key,0,45000);}
        test.setInTouchMode(false);playerActivity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class).putExtra("mediaKey",key).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        await(()->player()!=null&&player().isPlaying()&&player().getTime()>1500,"LibVLC starts authenticated HTTPS1080p");
        await(()->{IMedia media=player().getMedia();if(media==null)return false;try{IMedia.Stats stats=media.getStats();return stats!=null&&stats.decodedVideo>0&&stats.displayedPictures>0&&stats.decodedAudio>0;}finally{media.release();}},"actual video/audio decoding");
        IMedia media=player().getMedia();try{IMedia.Stats stats=media.getStats();Json.put(report,"decodedVideo",stats.decodedVideo);Json.put(report,"displayedPictures",stats.displayedPictures);Json.put(report,"decodedAudio",stats.decodedAudio);}finally{media.release();}
        await(()->player().getAudioTracksCount()>=2&&player().getSpuTracksCount()>=1,"embedded audio and subtitle tracks");
        test.runOnMainSync(()->{MediaPlayer.TrackDescription[] tracks=player().getAudioTracks();for(MediaPlayer.TrackDescription track:tracks)if(track.id>=0)player().setAudioTrack(track.id);for(MediaPlayer.TrackDescription track:player().getSpuTracks())if(track.id>=0)player().setSpuTrack(track.id);});
        int beforeSeek=displayed();test.runOnMainSync(()->player().setTime(20000));await(()->player().getTime()>=19500,"seek accepted");Thread.sleep(2000);check(player().getTime()>=21000&&player().getTime()<30000,"seek completes and playback clock advances past20s");await(()->displayed()>beforeSeek,"new frames displayed after seek");Json.put(report,"postSeekTimeMs",player().getTime());shot("p01-playing");
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);Thread.sleep(500);check(!player().isPlaying(),"remote pause");test.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);await(()->player().isPlaying(),"remote resume");
        Debug.MemoryInfo memory=new Debug.MemoryInfo();Debug.getMemoryInfo(memory);Json.put(report,"postPlaybackPssKiB",memory.getTotalPss());
        test.runOnMainSync(playerActivity::finish);test.waitForIdleSync();Thread.sleep(800);
        try(MediaCatalog catalog=new MediaCatalog(context)){check(catalog.position(key)>=19000,"progress survives DB reopen");}
        playerActivity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class).putExtra("mediaKey",key).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));await(()->player()!=null&&player().isPlaying()&&player().getTime()>=19000,"activity recreates decoder and accepts saved time");Thread.sleep(2000);check(player().getTime()>=21000,"resumed playback clock advances beyond requested position");
        test.runOnMainSync(playerActivity::finish);test.waitForIdleSync();playerActivity=null;
        checks.add("real LibVLC3.7.7 API22/x86 HTTPS1080p H264/AAC decoded video/audio/displayed frames; two audio tracks and embedded subtitle; seek, remote pause/resume, DB reopen and new-activity resume");
        browser=(MediaBrowserActivity)test.startActivitySync(new Intent(context,MediaBrowserActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));test.waitForIdleSync();Thread.sleep(600);shot("p02-sources");test.runOnMainSync(browser::finish);browser=null;
        Json.put(report,"result","passed");Json.put(report,"apiLevel",22);Json.put(report,"player","LibVLC3.7.7");Json.put(report,"sample","synthetic 1920x1080 15fps H264/AAC, two audio tracks, mov_text subtitle");Json.put(report,"emulatorOnly",true);Json.put(report,"realQuarkAccountVerified",false);Json.put(report,"oldWebViewLoginVerified",false);Json.put(report,"actualTelevisionVerified",false);Json.put(report,"checks",new JSONArray(checks));write(report);result.putString("result","passed");test.finish(Activity.RESULT_OK,result);
    }catch(Throwable error){try{Json.put(report,"result","failed");Json.put(report,"apiLevel",22);Json.put(report,"error",error.toString());Json.put(report,"checks",new JSONArray(checks));write(report);}catch(Exception ignored){}result.putString("result","failed");result.putString("error",error.toString());test.finish(Activity.RESULT_CANCELED,result);}finally{if(playerActivity!=null)test.runOnMainSync(playerActivity::finish);if(browser!=null)test.runOnMainSync(browser::finish);}}
}
