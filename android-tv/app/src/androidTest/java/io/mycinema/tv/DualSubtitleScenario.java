package io.mycinema.tv;

import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import is.xyz.mpv.MPVLib;
import java.io.File;
import java.io.FileOutputStream;

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
        tap(label,false);
    }
    private void tap(String label,boolean scroll)throws Exception{
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
            if(scroll)scrollForward(root);
            return false;
        },label);
        long now=SystemClock.uptimeMillis();
        for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){
            MotionEvent event=MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,rect.centerX(),rect.centerY(),0);
            test.sendPointerSync(event);event.recycle();
        }
        test.waitForIdleSync();
    }
    private boolean scrollForward(AccessibilityNodeInfo node){
        if(node.isScrollable()&&node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD))return true;
        for(int i=0;i<node.getChildCount();i++){
            AccessibilityNodeInfo child=node.getChild(i);
            if(child!=null&&scrollForward(child))return true;
        }
        return false;
    }
    private void pick(int slot,String label,boolean external)throws Exception{
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
        tap(slot==0?"主字幕":"副字幕");
        if(external)tap("选择同目录外挂字幕");
        tap(label);
    }
    private void pair(String primary,String secondary,int index)throws Exception{
        waitFor(()->primary.equals(MPVLib.getPropertyString("sub-text"))
            &&secondary.equals(MPVLib.getPropertyString("secondary-sub-text")),"pair "+index);
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        Thread.sleep(300);
        Bitmap capture=test.getUiAutomation().takeScreenshot();
        if(capture==null)throw new AssertionError("dual subtitle screenshot");
        try(FileOutputStream output=new FileOutputStream(new File(activity.getFilesDir(),"dual-"+index+".png"))){
            capture.compress(Bitmap.CompressFormat.PNG,100,output);
            for(int slot=0;slot<2;slot++){
                String visibility=slot==0?"sub-visibility":"secondary-sub-visibility";
                MPVLib.setPropertyBoolean(visibility,false);
                try{
                    final boolean lower=slot==0;
                    waitFor(()->{
                        Bitmap single=test.getUiAutomation().takeScreenshot();
                        if(single==null)return false;
                        try{return changedInSubtitleBand(capture,single,lower);}
                        finally{single.recycle();}
                    },"visible "+visibility+" pair "+index);
                }finally{MPVLib.setPropertyBoolean(visibility,true);}
                Thread.sleep(250);
            }
        }finally{capture.recycle();}
    }
    // With a paused frame and hidden controls only the selected subtitle should disappear.
    private static boolean changedInSubtitleBand(Bitmap both,Bitmap single,boolean lower){
        int h=both.getHeight(),w=both.getWidth(),changed=0,other=0;
        int[] a=new int[w],b=new int[w];
        for(int y=0;y<h;y+=2){
            both.getPixels(a,0,w,0,y,w,1);
            single.getPixels(b,0,w,0,y,w,1);
            for(int x=w/10;x<w*9/10;x+=2){
                if(a[x]==b[x])continue;
                if((y>=h/2)==lower)changed++;
                else other++;
            }
        }
        return changed>=80 && other<changed/4;
    }

    long run()throws Exception{
        Instrumentation.ActivityMonitor monitor=test.addMonitor(DualSubtitleActivity.class.getName(),null,false);
        try{
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
            tap("双字幕播放",true);
            activity=(DualSubtitleActivity)test.waitForMonitorWithTimeout(monitor,15000);
            if(activity==null)throw new AssertionError("dual subtitle playback menu");
            waitFor(()->{
                android.view.accessibility.AccessibilityNodeInfo root=test.getUiAutomation().getRootInActiveWindow();
                return root!=null && root.findAccessibilityNodeInfosByText("正在连接").isEmpty()
                    && !root.findAccessibilityNodeInfosByText("副字幕").isEmpty();
            },"connected dual subtitle controls");
            waitFor(()->{Double t=MPVLib.getPropertyDouble("time-pos");return t!=null&&t>=19;},"continue from the primary player");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
            waitFor(()->Boolean.TRUE.equals(MPVLib.getPropertyBoolean("pause")),"remote pause");
            waitFor(()->"MY CINEMA AUTOMATIC".equals(MPVLib.getPropertyString("sub-text")),"automatic primary sidecar");
            String embedded="My Cinema controlled playback test", second="副字幕测试 / SECONDARY EMBEDDED TEST";
            pick(0,"内嵌 1",false);pick(1,"内嵌 2",false);pair(embedded,second,0);
            pick(1,"附加B.srt",true);pair(embedded,"SECONDARY SIDECAR TEST",1);
            pick(0,"附加A.srt",true);pair("PRIMARY SIDECAR TEST","SECONDARY SIDECAR TEST",2);
            pick(1,"内嵌 2",false);pair("PRIMARY SIDECAR TEST",second,3);
            double pausedAt=MPVLib.getPropertyDouble("time-pos");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT);
            waitFor(()->Math.abs(MPVLib.getPropertyDouble("time-pos")-pausedAt-10)<1.0,"seek while paused");
            waitFor(()->"PRIMARY SIDECAR TEST".equals(MPVLib.getPropertyString("sub-text"))
                &&second.equals(MPVLib.getPropertyString("secondary-sub-text")),"both tracks after seek");
            pick(1,"关闭",false);
            waitFor(()->"PRIMARY SIDECAR TEST".equals(MPVLib.getPropertyString("sub-text"))
                &&!second.equals(MPVLib.getPropertyString("secondary-sub-text")),"independent disable");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
            waitFor(()->MPVLib.getPropertyDouble("time-pos")>pausedAt+11,"remote resume");
            return (long)(MPVLib.getPropertyDouble("time-pos")*1000);
        }finally{test.removeMonitor(monitor);if(activity!=null)test.runOnMainSync(activity::finish);test.waitForIdleSync();}
    }
}
