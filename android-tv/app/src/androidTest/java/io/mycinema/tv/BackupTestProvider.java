package io.mycinema.tv;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/** Controlled document store in the separate test APK. Never declared in the application. */
public final class BackupTestProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri uri){return "application/json";}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
        String name=uri.getLastPathSegment();if(name==null||!name.matches("[a-z-]+\\.json")||name.equals("denied.json"))throw new FileNotFoundException("Controlled document failure");
        return ParcelFileDescriptor.open(new File(getContext().getFilesDir(),"fixture-"+name),ParcelFileDescriptor.parseMode(mode));
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){return null;}
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String selection,String[] args){return 0;}
}
