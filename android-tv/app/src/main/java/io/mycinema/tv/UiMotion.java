package io.mycinema.tv;
import android.content.Context;
import android.provider.Settings;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
/** API21 compositor-only page/focus motion, respecting the system animation switch. */
final class UiMotion {
    static boolean enabled(Context context){return Settings.Global.getFloat(context.getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0;}
    static void enter(View view){view.animate().cancel();if(!enabled(view.getContext())){view.setAlpha(1);view.setTranslationY(0);return;}view.setAlpha(0);view.setTranslationY(RemoteUi.dp(view.getContext(),10));view.animate().alpha(1).translationY(0).setDuration(320).setInterpolator(new DecelerateInterpolator(1.6f)).start();}
    static void focus(View view,boolean focused){if(view==null)return;view.animate().cancel();float scale=focused?1.025f:1;if(enabled(view.getContext()))view.animate().scaleX(scale).scaleY(scale).setDuration(180).setInterpolator(new DecelerateInterpolator()).start();else{view.setScaleX(1);view.setScaleY(1);}}
}
