package io.mycinema.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import is.xyz.mpv.MPVLib;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;

final class DualSubtitleScenario {
    private final Instrumentation test;
    private DualSubtitleActivity activity;
    DualSubtitleScenario(Instrumentation test){this.test=test;}
    interface Check {boolean ready() throws Exception;}
    private void waitFor(Check condition,String label)throws Exception{
        long until=SystemClock.elapsedRealtime()+16000;
        do{if(condition.ready())return;Thread.sleep(150);}while(SystemClock.elapsedRealtime()<until);
        throw new AssertionError("dual subtitle: "+label);
    }
    private void tap(String label)throws Exception{
        Rect rect=new Rect();
        waitFor(()->{
            AccessibilityNodeInfo root=test.getUiAutomation().getRootInActiveWindow();
            if(root==null)return false;
            for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(label)){
                CharSequence value=node.getText();
                if(value!=null&&(value.toString().equals(label)||value.toString().startsWith(label+" ·"))){
                    node.getBoundsInScreen(rect);if(node.isVisibleToUser()&&!rect.isEmpty())return true;
                }
            }
            return false;
        },label);
        long now=SystemClock.uptimeMillis();
        for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){
            MotionEvent event=MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,rect.centerX(),rect.centerY(),0);
            test.sendPointerSync(event);event.recycle();
        }
        test.waitForIdleSync();
    }
    private MPVLib mpv()throws Exception{
        Field field=DualSubtitleActivity.class.getDeclaredField("engine");field.setAccessible(true);
        return (MPVLib)field.get(activity);
    }
    private void pick(int slot,String label,boolean external)throws Exception{
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
        tap(slot==0?"主字幕":"副字幕");
        if(external)tap("选择同目录外挂字幕");
        tap(label);
    }
    private void pair(String primary,String secondary,int index)throws Exception{
        waitFor(()->primary.equals(mpv().getPropertyString("sub-text"))
            &&secondary.equals(mpv().getPropertyString("secondary-sub-text")),"pair "+index);
        Thread.sleep(300);
        Bitmap capture=test.getUiAutomation().takeScreenshot();
        if(capture==null)throw new AssertionError("dual subtitle screenshot");
        try(FileOutputStream output=new FileOutputStream(new File(activity.getFilesDir(),"dual-"+index+".png"))){
            capture.compress(Bitmap.CompressFormat.PNG,100,output);
        }finally{capture.recycle();}
    }
    void run(MediaSources.Entry video)throws Exception{
        activity=(DualSubtitleActivity)test.startActivitySync(new Intent(test.getTargetContext(),DualSubtitleActivity.class)
            .putExtra("mediaKey",video.key()).putExtra("position",5000L).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try{
            waitFor(()->mpv()!=null&&mpv().getPropertyDouble("time-pos")!=null&&mpv().getPropertyDouble("time-pos")>5,"first frame clock");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
            waitFor(()->Boolean.TRUE.equals(mpv().getPropertyBoolean("pause")),"remote pause");
            String embedded="My Cinema controlled playback test", second="SECONDARY EMBEDDED TEST";
            pick(0,"内嵌 1",false);pick(1,"内嵌 2",false);pair(embedded,second,0);
            pick(1,"附加B.srt",true);pair(embedded,"SECONDARY SIDECAR TEST",1);
            pick(0,"附加A.srt",true);pair("PRIMARY SIDECAR TEST","SECONDARY SIDECAR TEST",2);
            pick(1,"内嵌 2",false);pair("PRIMARY SIDECAR TEST",second,3);
            pick(1,"关闭",false);
            waitFor(()->"PRIMARY SIDECAR TEST".equals(mpv().getPropertyString("sub-text"))
                &&!"SECONDARY EMBEDDED TEST".equals(mpv().getPropertyString("secondary-sub-text")),"independent disable");
        }finally{test.runOnMainSync(activity::finish);test.waitForIdleSync();}
    }
}
