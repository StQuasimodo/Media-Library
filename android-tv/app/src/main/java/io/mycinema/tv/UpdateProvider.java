package io.mycinema.tv;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Only explicitly granted, read-only update APKs. No library or credential file exposure. */
public final class UpdateProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    private File file(Uri uri) throws FileNotFoundException {if(!uri.getAuthority().equals(getContext().getPackageName()+".updates")||uri.getPathSegments().size()!=2||!uri.getPathSegments().get(0).equals("package")||!uri.getLastPathSegment().matches("[a-f0-9]{64}\\.apk"))throw new FileNotFoundException();File file=new File(new File(getContext().getFilesDir(),"updates"),uri.getLastPathSegment());if(!file.isFile())throw new FileNotFoundException();return file;}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {if(!mode.equals("r"))throw new FileNotFoundException();return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
    @Override public String getType(Uri uri){return "application/vnd.android.package-archive";}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){try{File file=file(uri);String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor cursor=new MatrixCursor(columns);Object[] values=new Object[columns.length];for(int i=0;i<columns.length;i++)values[i]=columns[i].equals(OpenableColumns.SIZE)?file.length():columns[i].equals(OpenableColumns.DISPLAY_NAME)?file.getName():null;cursor.addRow(values);return cursor;}catch(FileNotFoundException error){return null;}}
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String where,String[] args){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String where,String[] args){throw new UnsupportedOperationException();}
}
