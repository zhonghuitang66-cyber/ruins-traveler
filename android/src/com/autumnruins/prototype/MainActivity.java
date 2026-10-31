package com.autumnruins.prototype;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import java.io.*;
import java.util.*;

/** Local secure-origin assets plus the fixed HTTPS game service. No JS/native bridge. */
public final class MainActivity extends Activity {
    private WebView web;
    private boolean transportProbeStarted=false;
    private static final String HOST="appassets.androidplatform.net";
    private void immersive(){getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON|WindowManager.LayoutParams.FLAG_FULLSCREEN);immersive();
        web=new WebView(this);web.setBackgroundColor(0xffd6b46c);setContentView(web);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setUserAgentString(s.getUserAgentString()+" RuinsTravelerAndroid/0.3.0");
        s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);s.setSupportZoom(false);
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onConsoleMessage(ConsoleMessage m){android.util.Log.d("AutumnRuins",m.message()+" @"+m.lineNumber());return true;}
        });
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String url){
                if(!transportProbeStarted&&getIntent().getBooleanExtra("onlineSelfTest",false)&&url.equals("https://"+HOST+"/index.html")){
                    transportProbeStarted=true;
                    v.evaluateJavascript("fetch('https://114.66.36.160:9443/health').then(r=>{if(!r.ok)throw Error('http_'+r.status);return r.json()}).then(d=>console.log('ONLINE_TLS_PROBE '+JSON.stringify({ok:d.ok===true}))).catch(e=>console.log('ONLINE_TLS_PROBE '+JSON.stringify({ok:false,error:String(e)})));var probeSocket=new WebSocket('wss://114.66.36.160:9443/ws');probeSocket.onopen=()=>{console.log('ONLINE_WSS_PROBE '+JSON.stringify({ok:true}));probeSocket.close(1000,'transport-probe')};probeSocket.onerror=()=>console.log('ONLINE_WSS_PROBE '+JSON.stringify({ok:false}));",null);
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !HOST.equals(r.getUrl().getHost());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return resource(r.getUrl());}
        });
        web.loadUrl("https://"+HOST+"/index.html");
    }
    private WebResourceResponse resource(Uri uri){
        try{
            String apiPath=uri.getPath();
            if("https".equals(uri.getScheme())&&"114.66.36.160".equals(uri.getHost())&&uri.getPort()==9443&&apiPath!=null&&(apiPath.startsWith("/api/")||apiPath.equals("/health")))return null;
            if(!"https".equals(uri.getScheme())||!HOST.equals(uri.getHost()))return missing();
            String p=uri.getPath();if(p==null||p.contains("..")||p.indexOf('\\')>=0)return missing();
            if(p.equals("/"))p="/index.html";
            String mime=p.endsWith(".js")||p.endsWith(".mjs")?"text/javascript":p.endsWith(".html")?"text/html":p.endsWith(".css")?"text/css":p.endsWith(".png")?"image/png":p.endsWith(".jpg")||p.endsWith(".jpeg")?"image/jpeg":p.endsWith(".json")?"application/json":p.endsWith(".glb")?"model/gltf-binary":"application/octet-stream";
            InputStream stream=getAssets().open("web"+p);
            Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-cache");headers.put("X-Content-Type-Options","nosniff");
            return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,stream);
        }catch(IOException e){return missing();}
    }
    private WebResourceResponse missing(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",null,new ByteArrayInputStream(new byte[0]));}
    @Override protected void onPause(){if(web!=null){web.evaluateJavascript("window.dispatchEvent(new Event('blur'))",null);web.onPause();web.pauseTimers();}super.onPause();}
    @Override protected void onResume(){super.onResume();immersive();if(web!=null){web.onResume();web.resumeTimers();}}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)immersive();}
    @Override public void onBackPressed(){new android.app.AlertDialog.Builder(this).setMessage("结束本次探索并退出？当局未撤离物品不会入库。") .setNegativeButton("继续探索",(d,w)->immersive()).setPositiveButton("退出",(d,w)->finish()).show();}
    @Override protected void onDestroy(){if(web!=null){web.stopLoading();web.destroy();web=null;}super.onDestroy();}
}
