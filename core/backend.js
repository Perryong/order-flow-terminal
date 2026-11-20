(function(root){
  'use strict';
  function backendConfig(value=''){
    let origin='';
    if(value){
      const parsed=new URL(value);
      if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('Mac server must be an HTTPS origin');
      origin=parsed.origin;
    }
    return {origin,url(path){
      if(!path.startsWith('/api/')||path.startsWith('//'))throw Error('Expected a market-data API path');
      return origin+path;
    }};
  }
  if(typeof module==='object'&&module.exports)module.exports={backendConfig};
  else root.TapescopeBackend=backendConfig(root.TAPESCOPE_CONFIG?.apiOrigin||'');
})(globalThis);
