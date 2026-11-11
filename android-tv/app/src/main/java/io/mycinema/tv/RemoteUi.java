package io.mycinema.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import java.util.Locale;

/** Small API21-compatible helpers; focus never opens the keyboard without confirmation. */
final class RemoteUi {
    interface Rating {void chosen(Double value);}
    static int dp(Context context,int value){return Math.round(context.getResources().getDisplayMetrics().density*value);}
    static void button(Button button){
        button.setMinHeight(dp(button.getContext(),48));button.setFocusable(true);
        StateListDrawable states=new StateListDrawable();for(boolean focused:new boolean[]{true,false}){GradientDrawable surface=new GradientDrawable();surface.setColor(focused?0xff282f3b:0x00101216);surface.setCornerRadius(dp(button.getContext(),6));if(focused)surface.setStroke(dp(button.getContext(),2),MainActivity.ACCENT);if(!focused){GradientDrawable selected=new GradientDrawable();selected.setColor(0x40282f3b);selected.setCornerRadius(dp(button.getContext(),6));states.addState(new int[]{android.R.attr.state_selected},selected);}states.addState(focused?new int[]{android.R.attr.state_focused}:new int[]{},surface);}button.setBackground(states);
        button.setTag(R.id.remote_focus_key,button.getText().toString().replaceAll("^(个人评分|观看状态|更新来源|自动检查更新|资料语言|类型)：.*$","$1"));button.setOnFocusChangeListener((view,focused)->{if(focused)view.post(()->view.requestRectangleOnScreen(new Rect(0,0,view.getWidth(),view.getHeight()),false));});
    }
    static void input(EditText input){
        input.setShowSoftInputOnFocus(false);input.setContentDescription("确认键打开键盘；返回键收起键盘");
        Runnable open=()->{input.requestFocus();((InputMethodManager)input.getContext().getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(input,InputMethodManager.SHOW_IMPLICIT);};
        input.setOnClickListener(v->open.run());input.setOnKeyListener((view,code,event)->{if(code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER){if(event.getAction()==KeyEvent.ACTION_UP)open.run();return true;}return false;});
    }
    static View keyed(View root,String key){if(key.equals(root.getTag(R.id.remote_focus_key))&&root.isFocusable()&&root.isEnabled())return root;if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){View result=keyed(((ViewGroup)root).getChildAt(i),key);if(result!=null)return result;}return null;}
    static String focusKey(View focused,View root){for(View at=focused;at!=null;){if(at==root)return key(focused);android.view.ViewParent parent=at.getParent();at=parent instanceof View?(View)parent:null;}return "";}
    private static String key(View view){for(View at=view;at!=null;){Object key=at.getTag(R.id.remote_focus_key);if(key instanceof String)return (String)key;android.view.ViewParent parent=at.getParent();at=parent instanceof View?(View)parent:null;}return "";}
    static void listFocus(AlertDialog dialog,int selected){if(dialog.getWindow()!=null)dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);if(dialog.getListView()!=null){dialog.getListView().setSelection(Math.max(0,selected));dialog.getListView().requestFocus();}}
    static void rating(Activity owner,Double current,Rating result){String[] labels=new String[21];for(int i=0;i<labels.length;i++)labels[i]=String.format(Locale.ROOT,"%.1f 分",i/2.0);int selected=current==null?16:Math.max(0,Math.min(20,(int)Math.round(current*2)));AlertDialog dialog=new AlertDialog.Builder(owner).setTitle("选择个人评分 · 返回不修改").setSingleChoiceItems(labels,selected,(d,n)->{d.dismiss();result.chosen(n/2.0);}).setNeutralButton("清除评分",(d,n)->result.chosen(null)).setNegativeButton("取消",null).create();dialog.setOnShowListener(d->listFocus(dialog,selected));dialog.show();}
}
