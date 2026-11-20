package dev.ryoku.ryotunes;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        registerPlugin(RyotunesNativeMediaPlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(0xFF0B0910);
        getWindow().setNavigationBarColor(0xFF0B0910);
        WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(false);
            insetsController.setAppearanceLightNavigationBars(false);
        }
    }
}
