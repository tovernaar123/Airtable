# secret and token
How to get the secret and token 
let secret = await util.promisify(crypto.randomBytes)(256);
secret.toString("base64")
token = jwt.sign({}, bytes)
then make sure all client have token and the lobby server has secret
# the cert and key.pem files
https://www.openssl.org download this software run the .exe terminal and run this command
req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -addext "subjectAltName=IP:127.0.0.1"
with ip being the ip of the lobby server then make sure all client and server have the cert.pem and key.pem files 
