package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Environment;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Isolated test package: never replaces the historical io.mycinema.tv installation. */
final class UpgradeScenario {
    private final Instrumentation test;private final Context context;
    UpgradeScenario(Instrumentation test){this.test=test;context=test.getTargetContext();}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    void run(String phase,String buildRun){
        Bundle result=new Bundle();JSONObject report=new JSONObject();MainActivity activity=null;
        Json.put(report,"phase",phase);Json.put(report,"buildRun",buildRun);Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);
        try{
            check(context.getPackageName().equals("io.mycinema.tv.preview"),"migration fixture must use isolated package ID");
            File path=new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"MyCinema/legacy-migration.json");TvBackup backup=new TvBackup(context);JSONObject exported=backup.readFile(path);
            if(phase.equals("import"))backup.restore(exported);else check(phase.equals("upgrade"),"known test phase");
            Library.Item movie;
            try(Library library=new Library(context)){
                check(library.snapshot().toString().equals(exported.getJSONObject("collection").toString()),"all legacy collection records and IDs retained exactly");
                movie=library.list("Migration Movie","","","","recent").get(0);
                check(movie.entry.optDouble("personalRating")==9&&Json.text(movie.entry,"favoriteReason").equals("Legacy reason"),"legacy rating and reason retained");
            }
            SecretStore store=new SecretStore(context);
            if(phase.equals("import")){
                store.save("same-signer-upgrade-fixture");
                try(MediaCatalog catalog=new MediaCatalog(context)){
                    MediaSources.Entry file=new MediaSources.Entry("quark","upgrade-file","Migration.Movie.1080p.mp4","0",false,12345);catalog.put(file,movie.id());catalog.associate(file.key(),movie.id());catalog.progress(file.key(),45000,120000);
                }
            }
            check(store.read().equals("same-signer-upgrade-fixture"),"Keystore credential retained");
            try(MediaCatalog catalog=new MediaCatalog(context)){check(catalog.position("quark:upgrade-file")==45000&&Json.text(catalog.get("quark:upgrade-file"),"filmId").equals(movie.id())&&catalog.get("quark:upgrade-file").optBoolean("associationManual"),"media association and progress retained");}
            int code=context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode;check(code==(phase.equals("import")?7:8),"actual installed version code");
            activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));test.waitForIdleSync();Thread.sleep(500);
            Bitmap image=test.getUiAutomation().takeScreenshot();if(image!=null){try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"migration-"+phase+".png"))){image.compress(Bitmap.CompressFormat.PNG,100,output);}image.recycle();}
            Json.put(report,"packageId",context.getPackageName());Json.put(report,"versionCode",code);Json.put(report,"collectionIdentitiesPreserved",true);Json.put(report,"keystoreCredentialPreserved",true);Json.put(report,"mediaProgressPreserved",true);Json.put(report,"physicalTelevisionVerified",false);Json.put(report,"result","passed");result.putString("result","passed");
        }catch(Throwable failure){Json.put(report,"result","failed");Json.put(report,"error",failure.toString());result.putString("result","failed");result.putString("error",failure.toString());}
        finally{
            if(activity!=null){final MainActivity owner=activity;test.runOnMainSync(owner::finish);}
            try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"migration-"+phase+".json"))){output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}catch(Exception failure){result.putString("result","failed");}
            test.finish("passed".equals(result.getString("result"))?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
        }
    }
}
