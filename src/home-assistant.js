export class HomeAssistantAdapter{
constructor(connection=null){this.connection=connection;this.states=new Map()}
isConnected(){return Boolean(this.connection)}
setConnection(connection){this.connection=connection}
setState(entityId,state){this.states.set(entityId,state)}
getState(entityId){return this.states.get(entityId)??null}
async callService(domain,service,data={}){if(!this.connection?.callService)throw new Error("Home Assistant connection unavailable");return this.connection.callService(domain,service,data)}
}