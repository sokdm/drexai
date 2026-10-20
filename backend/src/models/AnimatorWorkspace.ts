import {Schema,model} from 'mongoose';
const schema=new Schema({userId:{type:Schema.Types.ObjectId,required:true,unique:true,index:true},editId:{type:Schema.Types.ObjectId},characterAssetId:{type:Schema.Types.ObjectId},referenceAudioAssetId:{type:Schema.Types.ObjectId},aspectRatio:{type:String,enum:['9:16','16:9','1:1'],default:'9:16'},microphone:{type:Boolean,default:false}},{timestamps:true});
export const AnimatorWorkspace=model('AnimatorWorkspace',schema);
