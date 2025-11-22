function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("accessToken")) props.setProperty("accessToken", randomBase64(128));
  console.log(
    "Script configured!\n\nTHIS IS YOUR ACCESS TOKEN:\n"
    + props.getProperty("accessToken")
    + "\n\nKeep it secret, and never share it with anyone else.");
}

function resetScriptData() {
  const props = PropertiesService.getScriptProperties();
  props.deleteAllProperties();
  console.log("Script data successfully reset. Please remember to regenerate an access token by running setup.");
}

function randomBase64(length) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}

function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("accessToken");
  const output = { version: 2 };

  if (!token || req.token !== token) {
    output.status = "ERROR";
    output.result = "unauthorized";
  } else {
    let callback = null;
    switch (req.request) {
      case "list": callback = findEmails; break;
      case "fetch": callback = getEmails; break;
      case "test": callback = validate; break;
    }
    if (callback) {
      output.status = "OK";
      output.result = callback(req.options);
    } else {
      output.status = "ERROR";
      output.result = "unknown_route";
    }
  }
  var contentSvc = ContentService.createTextOutput(JSON.stringify(output));
  contentSvc.setMimeType(ContentService.MimeType.JSON);
  return contentSvc;
}

function findEmails({ since, offset, size }) {
  const senders = [
    "notices@recon.nianticspatial.com",
    "notices@wayfarer.nianticlabs.com",
    "nominations@portals.ingress.com",
    "hello@pokemongolive.com",
    "ingress-support@nianticlabs.com",
    "ingress-support@google.com"
  ].map(e => "from:" + e);
  if (since == "") since = "1970-01-01";
  if (!since.match(/^\d{4}-\d{2}-\d{2}$/)) return [];
  const emails = [];
  const threads = GmailApp.search("(" + senders.join(" | ") + ") after:" + since, offset, size);
  for (j = 0; j < threads.length; j++) emails.push(threads[j].getId());
  return emails;
}

function getEmails({ ids }) {
  const emls = {};
  for (let i = 0; i < ids.length; i++) {
    emls[ids[i]] = GmailApp.getThreadById(ids[i]).getMessages()[0].getRawContent();
  }
  return emls;
}

function validate() {
  return "success";
}
