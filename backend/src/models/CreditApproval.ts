import {Schema,model} from "mongoose";
const schema=new Schema({userId:{type:Schema.Types.ObjectId,required:true,index:true},conversationId:Schema.Types.ObjectId,productionId:{type:Schema.Types.ObjectId,required:true,index:true},scope:{type:String,enum:["operation","production"],required:true},signature:{type:String,required:true},operation:String,models:[String],quantity:Number,credits:{type:Number,required:true},stepKeys:[String],expiresAt:Date,status:{type:String,enum:["pending","approved","rejected","completed","failed","superseded"],default:"pending"},reservationId:Schema.Types.ObjectId,decidedAt:Date,completedAt:Date},{timestamps:true});
schema.index({userId:1,productionId:1,scope:1,signature:1},{unique:true});
export const CreditApproval=model("CreditApproval",schema);
