# pure-leak

# Solution 

This was an unintended solution for a previous challenge made at [asis ctf 2025](https://blog.arkark.dev/2025/09/08/asisctf-quals). The goal was still to cause a PHP warning to trigger quirks mode, but this time we triggered the warning by exceeding the `max_file_uploads` which its default of 20: [php](https://www.php.net/manual/en/ini.core.php#ini.sect.file-uploads). 

You can do that with an HTML form with 21 file inputs, and then submit it with a `DataTransfer` object that has 21 files. The warning is emitted before the `<!DOCTYPE html>` so the page is parsed in quirks mode. The rest of the solve is similar to the previous one, we gonna use the same `:valid/pattern` trick to capture the token, but this time, if a character is valid, we gonna send too many same-origin requests, which will cause a timing oracle. 

Caddy balances all normal paths across four PHP built-in servers, and we can trigger a timing gap here to distinguish the correct char from the wrong one. Each PHP built-in server is effectively **single-threaded**, so with four processes, the application can actively serve about four dynamic requests at once.

When `input:valid` loads too many background URLs, Chrome starts many same-origin requests: 
```css
input:valid {
  background-image: url(/00), url(/01), ...;
}
```
caddy forwards them across the four PHP upstreams. A PHP process must finish its current request before it can serve the next one, so requests accumulate behind the four active workers. Then we drain 14 requests sequentially, awaiting each before issuing the next, and time the whole batch from navigation commit:
```js
const s = performance.now();
  for (let i = 0; i < 14; i++) {
    await fetch(APP + "/?q=" + id + i + Math.random(),
                { mode: "no-cors", cache: "no-store" });
  }
  return performance.now() - s;
```
If the guess is incorrect, the CSS requests never exist, and the 14 probes find workers mostly free, and it will complete quickly. If the guess is correct, the probes arrive while workers are busy with the CSS requests. The attacker cannot read the cross-origin responses, but JavaScript can measure when the fetch promises settle. So basically: 

wrong guess => 14 probes => 4 available PHP workers => fast

correct guess => too many css requests => worker queues => 14 probes => 4 PHP workers are busy=> slow
