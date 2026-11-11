package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Compiled against the original alpha.5 source, executed inside the exact published APK. */
final class LegacyBaselineScenario {
    private final Instrumentation test;
    LegacyBaselineScenario(Instrumentation test){this.test=test;}
    void run(){Bundle result=new Bundle();Context context=test.getTargetContext();try{
        if(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode!=8)throw new AssertionError("published baseline version code");
        Library.Item item;try(Library library=new Library(context)){JSONObject movie=new JSONObject();Json.put(movie,"title","Upgrade preservation");Json.put(movie,"mediaType","movie");Json.put(movie,"externalId","");item=library.saveCandidate(movie);JSONObject entry=new JSONObject();Json.put(entry,"watchStatus","watched");Json.put(entry,"personalRating",8.5);Json.put(entry,"favoriteReason","fixed signer upgrade fixture");library.updateEntry(item.id(),entry);}
        new SecretStore(context).save("upgrade-metadata-fixture");new SecretStore(context,"quark","夸克").save("__puus=upgrade-account-fixture");new SecretStore(context,"webdav","WebDAV").save("upgrade-webdav-fixture");
        context.getSharedPreferences("quark-dav",Context.MODE_PRIVATE).edit().putBoolean("enabled",true).putString("folderId","saved-folder").putString("folderName","Saved folder").commit();context.getSharedPreferences("app-updates",Context.MODE_PRIVATE).edit().putBoolean("automatic",false).commit();
        try(MediaCatalog catalog=new MediaCatalog(context)){MediaSources.Entry file=new MediaSources.Entry("quark","upgrade-preserved-file","Upgrade.Preservation.1080p.H264.mkv","saved-folder",false,98765);catalog.put(file,item.id());catalog.associate(file.key(),item.id());catalog.progress(file.key(),45123,90000);}
        JSONObject baseline=new TvBackup(context).snapshot();try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"upgrade-baseline.json"))){output.write(baseline.toString(2).getBytes(StandardCharsets.UTF_8));}
        result.putString("result","passed");
    }catch(Throwable error){result.putString("result","failed");result.putString("error",error.toString());}test.finish("passed".equals(result.getString("result"))?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);}
}
